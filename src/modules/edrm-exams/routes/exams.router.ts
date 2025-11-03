import { EnduranceAuthMiddleware, EnduranceRouter, SecurityOptions, enduranceEmitter as emitter, enduranceEventTypes as eventTypes } from '@programisto/endurance-core';
import { Document, Types } from 'mongoose';
import { generateLiveMessage, generateLiveMessageAssistant } from '../lib/openai.js';
import Candidate from '../models/candidate.model.js';
import ContactModel from '../models/contact.model.js';
import TestCategory from '../models/test-category.models.js';
import TestJob from '../models/test-job.model.js';
import TestQuestion from '../models/test-question.model.js';
import TestResult from '../models/test-result.model.js';
import Test from '../models/test.model.js';

// Fonction utilitaire pour récupérer le nom du job
async function getJobName(targetJob: any): Promise<string> {
  // Si c'est déjà une string (ancien format), on la retourne directement
  if (typeof targetJob === 'string') {
    return targetJob;
  }

  // Si c'est un ObjectId, on récupère le job
  if (targetJob && typeof targetJob === 'object' && targetJob._id) {
    const job = await TestJob.findById(targetJob._id);
    return job ? job.name : 'Job inconnu';
  }

  // Si c'est juste un ObjectId
  if (targetJob && typeof targetJob === 'object' && targetJob.toString) {
    const job = await TestJob.findById(targetJob);
    return job ? job.name : 'Job inconnu';
  }

  return 'Job inconnu';
}

// Fonction pour migrer automatiquement un test si nécessaire
async function migrateTestIfNeeded(test: any): Promise<void> {
  if (typeof test.targetJob === 'string') {
    await test.migrateTargetJob();
  }
}

// Définition des types
interface TestQuestionRef {
  questionId: Types.ObjectId;
  categoryId: Types.ObjectId;
  order: number;
}

interface TestCategoryRef {
  categoryId: Types.ObjectId;
  expertiseLevel: number;
}

// Extension du type Test pour inclure les propriétés manquantes
interface ExtendedTest extends Document {
  categories: TestCategoryRef[];
  questions: TestQuestionRef[];
  invitationText?: string;
  testName: string;
  title: string;
  targetJob: string;
  seniorityLevel: string;
}

// Extension du type Result pour inclure les propriétés manquantes
interface ExtendedResult extends Document {
  testId: Types.ObjectId;
  state: string;
  responses: Array<{
    questionId: Types.ObjectId;
    response: string;
    score?: number;
    comment?: string;
  }>;
  score?: number;
}

class ExamsRouter extends EnduranceRouter {
  constructor() {
    super(EnduranceAuthMiddleware.getInstance());
  }

  private async generateAndSaveQuestion(
    test: ExtendedTest,
    categoryInfo: { categoryId: string, expertiseLevel: string },
    useAssistant: boolean = false
  ): Promise<Document | null> {
    try {
      // Récupérer les questions existantes pour éviter les doublons
      const otherQuestionsIds = test.questions.map(question => question.questionId);
      const otherQuestions = await TestQuestion.find({ _id: { $in: otherQuestionsIds } });

      const jobName = await getJobName(test.targetJob);

      // Récupérer la catégorie pour obtenir son nom
      const categoryDoc = await TestCategory.findById(categoryInfo.categoryId);
      if (!categoryDoc) {
        console.error('Catégorie non trouvée pour categoryId:', categoryInfo.categoryId);
        return null;
      }
      const categoryName = categoryDoc.name;

      // Génération de la question avec la catégorie spécifiée
      const questionParams = {
        job: jobName,
        seniority: test.seniorityLevel,
        category: categoryName, // Utiliser le nom de la catégorie
        questionType: ['MCQ', 'free question', 'exercice'][Math.floor(Math.random() * 3)],
        expertiseLevel: categoryInfo.expertiseLevel,
        otherQuestions: otherQuestions.map(question => question.instruction).join('\n')
      };

      let generatedQuestion: string;
      if (useAssistant) {
        generatedQuestion = await generateLiveMessageAssistant(
          process.env.OPENAI_ASSISTANT_ID_CREATE_QUESTION || '',
          'createQuestion',
          questionParams,
          true
        );
      } else {
        generatedQuestion = await generateLiveMessage(
          'createQuestion',
          questionParams,
          true
        );
      }

      if (generatedQuestion === 'Brain freezed, I cannot generate a live message right now.') {
        console.error('Échec de génération de question');
        return null;
      }

      const questionData = JSON.parse(generatedQuestion);

      console.log('[DEBUG] questionData reçu de l\'IA:', JSON.stringify(questionData, null, 2));

      // Utiliser le categoryId fourni dans categoryInfo
      const assignedCategoryId = new Types.ObjectId(categoryInfo.categoryId);

      console.log(`[DEBUG] Création de question avec categoryId: ${assignedCategoryId.toString()}`);

      // Créer la question avec le categoryId spécifié (écrase toute valeur dans questionData)
      // NE PAS inclure questionData.categoryId s'il existe (l'écraser toujours)
      const questionToCreate: any = {
        questionType: questionData.questionType,
        instruction: questionData.instruction,
        maxScore: questionData.maxScore,
        time: questionData.time,
        textType: questionData.textType || 'text',
        categoryId: assignedCategoryId // TOUJOURS utiliser celui sélectionné
      };

      // Ajouter possibleResponses uniquement si présent
      if (questionData.possibleResponses) {
        questionToCreate.possibleResponses = questionData.possibleResponses;
      }

      console.log('[DEBUG] Question à créer:', JSON.stringify({
        ...questionToCreate,
        categoryId: questionToCreate.categoryId.toString()
      }, null, 2));

      const question = new TestQuestion(questionToCreate);
      await question.save();

      // Vérifier que categoryId a bien été sauvegardé
      const savedQuestion = await TestQuestion.findById(question._id);
      if (savedQuestion && savedQuestion.categoryId) {
        console.log(`[DEBUG] Question ${question._id} sauvegardée avec categoryId: ${savedQuestion.categoryId.toString()}`);
      } else {
        console.error(`[ERREUR] Question ${question._id} sauvegardée SANS categoryId !`);
      }

      // Ajouter la question au test avec le categoryId et sauvegarder immédiatement
      test.questions.push({
        questionId: question._id,
        categoryId: assignedCategoryId, // Toujours utiliser le categoryId sélectionné
        order: test.questions.length
      });
      await test.save();

      return question;
    } catch (error) {
      console.error('Erreur lors de la génération/sauvegarde de la question:', error);
      return null;
    }
  }

  setupRoutes(): void {
    const authenticatedOptions: SecurityOptions = {
      requireAuth: false,
      permissions: []
    };
    // Créer une catégorie
    this.post('/categories', authenticatedOptions, async (req: any, res: any) => {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ message: 'Error, all params are required' });
      }

      try {
        const newCategory = new TestCategory({ name });
        await newCategory.save();
        res.status(201).json({ message: 'category created with sucess', category: newCategory });
      } catch (err) {
        console.error('error when creating category : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Lister toutes les catégories
    this.get('/categories', authenticatedOptions, async (req: any, res: any) => {
      try {
        const categories = await TestCategory.find();
        res.status(200).json({ array: categories });
      } catch (err) {
        console.error('error when creating category : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir une catégorie par son ID
    this.get('/categorie/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      try {
        const category = await TestCategory.findById(id);
        if (!category) {
          return res.status(404).json({ message: 'no category founded with this id' });
        }
        res.status(200).json({ array: category });
      } catch (err) {
        console.error('error when creating category : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Créer un job type
    this.post('/jobs', authenticatedOptions, async (req: any, res: any) => {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ message: 'Error, name is required' });
      }

      try {
        const newJob = new TestJob({ name });
        await newJob.save();
        res.status(201).json({ message: 'job created with success', job: newJob });
      } catch (err) {
        console.error('error when creating job : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Lister tous les jobs
    this.get('/jobs', authenticatedOptions, async (req: any, res: any) => {
      try {
        const jobs = await TestJob.find();
        res.status(200).json({ array: jobs });
      } catch (err) {
        console.error('error when getting jobs : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir un job par son ID
    this.get('/jobs/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      try {
        const job = await TestJob.findById(id);
        if (!job) {
          return res.status(404).json({ message: 'no job founded with this id' });
        }
        res.status(200).json({ array: job });
      } catch (err) {
        console.error('error when getting job : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Migrer tous les tests avec l'ancien format targetJob
    this.post('/migrate-targetjobs', authenticatedOptions, async (req: any, res: any) => {
      try {
        const tests = await Test.find();
        let migratedCount = 0;
        let errorCount = 0;

        for (const test of tests) {
          try {
            // Vérifier si le test a besoin de migration
            if (typeof test.targetJob === 'string') {
              await test.migrateTargetJob();
              migratedCount++;
            }
          } catch (error) {
            console.error(`Erreur lors de la migration du test ${test._id}:`, error);
            errorCount++;
          }
        }

        res.status(200).json({
          message: `Migration terminée. ${migratedCount} tests migrés, ${errorCount} erreurs.`,
          migratedCount,
          errorCount
        });
      } catch (err) {
        console.error('Erreur lors de la migration :', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Migrer les questions pour ajouter le categoryId manquant
    this.post('/migrate-questions-category', authenticatedOptions, async (req: any, res: any) => {
      try {
        const tests = await Test.find();
        let testsUpdated = 0;
        let questionsUpdated = 0;
        let questionsInTestUpdated = 0;
        let errorCount = 0;

        for (const test of tests) {
          try {
            // Si le test a des catégories
            if (test.categories && test.categories.length > 0) {
              let testModified = false;

              // Pour chaque question du test
              for (let i = 0; i < test.questions.length; i++) {
                const testQuestion = test.questions[i];

                // Vérifier si test.questions n'a pas de categoryId (ou categoryId invalide)
                const hasCategoryId = testQuestion.categoryId && testQuestion.categoryId.toString();

                if (!hasCategoryId) {
                  // Récupérer la question elle-même pour voir si elle a un categoryId
                  const question = await TestQuestion.findById(testQuestion.questionId);
                  let categoryIdToAssign: any = null;

                  if (question) {
                    // Si la question a déjà un categoryId, l'utiliser
                    if (question.categoryId) {
                      categoryIdToAssign = question.categoryId;
                    } else {
                      // Sinon, utiliser la première catégorie du test
                      categoryIdToAssign = test.categories[0].categoryId;
                      // Aussi mettre à jour la question elle-même
                      question.categoryId = categoryIdToAssign;
                      await question.save();
                      questionsUpdated++;
                    }
                  } else {
                    // Si la question n'existe pas, utiliser la première catégorie du test
                    categoryIdToAssign = test.categories[0].categoryId;
                  }

                  // Mettre à jour test.questions avec le categoryId
                  (testQuestion as any).categoryId = new Types.ObjectId(categoryIdToAssign);
                  testModified = true;
                  questionsInTestUpdated++;
                }
              }

              // Sauvegarder le test si modifié
              if (testModified) {
                await test.save();
                testsUpdated++;
              }
            }
          } catch (error) {
            console.error(`Erreur lors de la migration du test ${test._id}:`, error);
            errorCount++;
          }
        }

        res.status(200).json({
          message: 'Migration des categoryId terminée',
          testsUpdated,
          questionsUpdated,
          questionsInTestUpdated,
          errorCount
        });
      } catch (err) {
        console.error('Erreur lors de la migration des categoryId :', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Créer un test
    this.post('/test', authenticatedOptions, async (req: any, res: any) => {
      const { title, description, targetJob, seniorityLevel, categories, state = 'draft' } = req.body;
      const user = req.user;

      if (!title || !targetJob || !seniorityLevel) {
        return res.status(400).json({ message: 'Error, all params are required' });
      }

      try {
        const companyId = user?.companyId;
        const userId = user?._id;

        // Traiter le targetJob - si c'est une string, on cherche ou crée le TestJob
        let targetJobId;
        if (typeof targetJob === 'string') {
          let existingJob = await TestJob.findOne({ name: targetJob });
          if (!existingJob) {
            existingJob = new TestJob({ name: targetJob });
            await existingJob.save();
          }
          targetJobId = existingJob._id;
        } else {
          targetJobId = targetJob;
        }

        const processedCategories = await Promise.all(categories?.map(async (category: { name: string, expertiseLevel: string }) => {
          let existingCategory = await TestCategory.findOne({ name: category.name });

          if (!existingCategory) {
            existingCategory = await TestCategory.create({ name: category.name });
          }

          return {
            categoryId: existingCategory._id,
            expertiseLevel: category.expertiseLevel
          };
        }) || []);

        const newTest = new Test({
          companyId,
          userId,
          title,
          description,
          targetJob: targetJobId,
          seniorityLevel,
          state,
          categories: processedCategories
        });
        await newTest.save();
        res.status(201).json({ message: 'test created with sucess', data: newTest });
      } catch (err) {
        console.error('error when creating test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Modifier un test
    this.put('/test/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { title, description, targetJob, seniorityLevel, categories, state, questions } = req.body;

      try {
        const test = await Test.findById(id);
        if (!test) {
          return res.status(404).json({ message: 'Test non trouvé' });
        }

        if (title) test.title = title;
        if (description) test.description = description;
        if (targetJob) {
          // Traiter le targetJob - si c'est une string, on cherche ou crée le TestJob
          if (typeof targetJob === 'string') {
            let existingJob = await TestJob.findOne({ name: targetJob });
            if (!existingJob) {
              existingJob = new TestJob({ name: targetJob });
              await existingJob.save();
            }
            (test as any).targetJob = existingJob._id;
          } else {
            test.targetJob = targetJob;
          }
        }
        if (seniorityLevel) test.seniorityLevel = seniorityLevel;
        if (state) test.state = state;

        if (categories) {
          const processedCategories = await Promise.all(categories.map(async (category: { name: string, expertiseLevel: string }) => {
            let existingCategory = await TestCategory.findOne({ name: category.name });

            if (!existingCategory) {
              existingCategory = await TestCategory.create({ name: category.name });
            }

            return {
              categoryId: existingCategory._id,
              expertiseLevel: category.expertiseLevel
            };
          }));

          test.categories = processedCategories;
        }

        if (questions) {
          // Vérifier que toutes les questions existent
          const questionIds = questions.map((q: any) => q.questionId);
          const existingQuestions = await TestQuestion.find({ _id: { $in: questionIds } });

          if (existingQuestions.length !== questionIds.length) {
            return res.status(400).json({
              message: 'Certaines questions spécifiées n\'existent pas',
              providedQuestions: questionIds.length,
              foundQuestions: existingQuestions.length
            });
          }

          // Créer un Map pour accéder rapidement aux questions par leur ID
          const questionsMap = new Map(existingQuestions.map(q => [q._id.toString(), q]));

          // Mettre à jour les questions avec leur ordre et categoryId
          test.questions = questions.map((q: any) => {
            const questionDoc = questionsMap.get(q.questionId.toString());
            const categoryId = q.categoryId || questionDoc?.categoryId;

            if (!categoryId) {
              throw new Error(`categoryId manquant pour la question ${q.questionId}`);
            }

            return {
              questionId: q.questionId,
              categoryId,
              order: q.order || 0
            };
          });
        }

        await test.save();
        res.status(200).json({ message: 'Test modifié avec succès', data: test });
      } catch (err) {
        console.error('Erreur lors de la modification du test : ', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Supprimer un test
    this.delete('/test/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const test = await Test.findById(id);
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }
        for (let i = 0; i < test.questions.length; i++) {
          await TestQuestion.findByIdAndDelete(test.questions[i].questionId);
        }
        await TestResult.deleteMany({ testId: id });
        await Test.findByIdAndDelete(id);
        res.status(200).json({ message: 'test deleted with sucess' });
      } catch (err) {
        console.error('error when deleting user : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir un test par son ID
    this.get('/test/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const test = await Test.findById(id);

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        // Migration automatique si nécessaire
        await migrateTestIfNeeded(test);

        const questions: any[] = [];
        console.log(`[DEBUG] Traitement de ${test.questions.length} questions pour le test ${id}`);
        console.log('[DEBUG] Structure de test.questions:', JSON.stringify(test.questions[0], null, 2));

        for (const questionRef of test.questions) {
          console.log('[DEBUG] questionRef:', {
            questionId: questionRef.questionId,
            categoryId: questionRef.categoryId,
            order: questionRef.order,
            typeQuestionRefCategoryId: typeof questionRef.categoryId,
            questionRefKeys: Object.keys(questionRef || {})
          });

          // Utiliser .lean() pour obtenir un objet plain JavaScript (évite les problèmes de sérialisation)
          const question = await TestQuestion.findById(questionRef.questionId).lean();
          if (question) {
            console.log('[DEBUG] Question trouvée (lean):', {
              _id: (question as any)._id,
              categoryId: (question as any).categoryId,
              typeQuestionCategoryId: typeof (question as any).categoryId,
              hasCategoryId: !!(question as any).categoryId
            });

            const questionObj: any = { ...question }; // Copie de l'objet lean
            console.log('[DEBUG] questionObj après toObject:', {
              _id: questionObj._id,
              categoryId: questionObj.categoryId,
              hasCategoryId: 'categoryId' in questionObj
            });

            // Fonction helper pour convertir en string
            const toString = (id: any): string | null => {
              if (!id) return null;
              if (typeof id === 'string') return id;
              if (id.toString) return id.toString();
              return null;
            };

            // Enrichir la question avec le categoryId depuis test.questions[] si présent
            // Prioriser le categoryId de test.questions[] car c'est la source de vérité
            // Sinon, utiliser le categoryId de la question elle-même
            // En dernier recours, utiliser la première catégorie du test (pour les anciennes questions)
            let categoryId: string | null = null;
            const questionId = (question as any)._id;
            const questionCategoryId = (question as any).categoryId;

            if (questionRef.categoryId) {
              categoryId = toString(questionRef.categoryId);
              console.log(`[DEBUG] Utilisation questionRef.categoryId: ${categoryId}`);
            } else if (questionCategoryId) {
              // Fallback 1 : utiliser le categoryId de la question elle-même
              categoryId = toString(questionCategoryId);
              console.log(`[DEBUG] Utilisation question.categoryId: ${categoryId}`);
            } else if (test.categories && test.categories.length > 0) {
              // Fallback 2 : utiliser la première catégorie du test (pour les anciennes questions sans categoryId)
              categoryId = toString(test.categories[0].categoryId);
              console.warn(`[DEBUG] Aucun categoryId trouvé pour la question ${questionId}, utilisation de la première catégorie du test: ${categoryId}`);
            } else {
              console.warn(`[DEBUG] AUCUN categoryId trouvé pour la question ${questionId} et aucune catégorie dans le test`);
            }

            // Toujours définir categoryId (même si null, pour que le frontend le détecte)
            questionObj.categoryId = categoryId;

            console.log('[DEBUG] questionObj AVANT push:', {
              _id: questionObj._id || questionId,
              categoryId: questionObj.categoryId,
              hasCategoryId: 'categoryId' in questionObj
            });

            // Ajouter aussi l'ordre de la question dans le test
            questionObj.order = questionRef.order;
            questions.push(questionObj);
          } else {
            console.warn(`[DEBUG] Question non trouvée pour questionId: ${questionRef.questionId}`);
          }
        }

        console.log(`[DEBUG] Questions finales (${questions.length}):`, questions.map(q => ({
          _id: q._id,
          categoryId: q.categoryId,
          hasCategoryId: 'categoryId' in q
        })));

        // Récupérer le nom du job pour l'affichage
        const testObj = test.toObject();
        (testObj as any).targetJobName = await getJobName(testObj.targetJob);

        // Log final avant envoi pour vérifier que categoryId est bien présent
        console.log('[DEBUG] Réponse JSON finale - Vérification categoryId:', {
          nombreQuestions: questions.length,
          questions: questions.map(q => ({
            _id: q._id,
            categoryId: q.categoryId,
            categoryIdType: typeof q.categoryId,
            hasCategoryId: 'categoryId' in q
          }))
        });

        res.status(200).json({ test: testObj, questions });
      } catch (err) {
        console.error('error when geting test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Lister tous les tests
    this.get('/', authenticatedOptions, async (req: any, res: any) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search as string || '';
        const targetJob = req.query.targetJob as string || 'all';
        const seniorityLevel = req.query.seniorityLevel as string || 'all';
        const state = req.query.state as string || 'all';
        const sortBy = req.query.sortBy as string || 'updatedAt';
        const sortOrder = req.query.sortOrder as string || 'desc';

        // Construction de la requête de recherche
        const query: any = {};

        // Filtres
        if (targetJob !== 'all') {
          // Si on filtre par targetJob, on cherche d'abord le TestJob correspondant
          const jobType = await TestJob.findOne({ name: targetJob });
          if (jobType) {
            query.targetJob = jobType._id;
          } else {
            // Si le job n'existe pas, on ne retourne aucun résultat
            query.targetJob = null;
          }
        }
        if (seniorityLevel !== 'all') {
          query.seniorityLevel = seniorityLevel;
        }
        if (state !== 'all') {
          query.state = state;
        }

        // Recherche sur testName et targetJob
        if (search) {
          // Pour la recherche sur targetJob, on cherche d'abord les jobs qui correspondent
          const matchingJobs = await TestJob.find({ name: { $regex: search, $options: 'i' } });
          const jobIds = matchingJobs.map(job => job._id);

          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { targetJob: { $in: jobIds } },
            { seniorityLevel: { $regex: search, $options: 'i' } }
          ];
        }

        // Construction du tri
        const allowedSortFields = ['testName', 'targetJob', 'seniorityLevel', 'updatedAt'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'updatedAt';
        const sortOptions: Record<string, 1 | -1> = {
          [sortField]: sortOrder === 'asc' ? 1 : -1
        };

        const [tests, total] = await Promise.all([
          Test.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .exec(),
          Test.countDocuments(query)
        ]);

        // Récupérer les noms des catégories et des jobs pour chaque test
        const testsWithCategories = await Promise.all(tests.map(async (test) => {
          // Migration automatique si nécessaire
          await migrateTestIfNeeded(test);

          const testObj = test.toObject();

          // Récupérer le nom du job
          (testObj as any).targetJobName = await getJobName(testObj.targetJob);

          if (testObj.categories && testObj.categories.length > 0) {
            const categoriesWithNames = await Promise.all(testObj.categories.map(async (category) => {
              const categoryDoc = await TestCategory.findById(category.categoryId);
              return {
                ...category,
                categoryName: categoryDoc?.name || 'Catégorie inconnue'
              };
            }));
            testObj.categories = categoriesWithNames;
          }
          return testObj;
        }));

        const totalPages = Math.ceil(total / limit);

        return res.json({
          data: testsWithCategories,
          pagination: {
            currentPage: page,
            totalPages,
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1
          }
        });
      } catch (err) {
        console.error('error when geting tests : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Supprimer une catégorie d'un test
    this.delete('/test/removeCategory/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;
      const { categoryName } = req.body;

      try {
        const category = await TestCategory.findOne({ name: categoryName });
        if (!category) return res.status(404).json({ message: 'Category not found' });

        const test = await Test.findByIdAndUpdate(
          testId,
          { $pull: { categories: { categoryId: category._id } } },
          { new: true }
        );

        if (!test) return res.status(404).json({ message: 'Test not found' });

        res.status(200).json({ message: 'Category removed', test });
      } catch (err) {
        console.error('Error when removing category from test:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Ajouter une catégorie à un test
    this.put('/test/addCategory/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;
      const { categoryName, expertiseLevel } = req.body;

      try {
        let category = await TestCategory.findOne({ name: categoryName });

        if (!category) {
          category = new TestCategory({ name: categoryName });
          await category.save();
        }

        const test = await Test.findById(testId) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const categoryExists = test.categories.some(cat => cat.categoryId.equals(category._id));

        if (categoryExists) {
          return res.status(200).json({ message: 'Category already exists in the test' });
        }

        test.categories.push({ categoryId: category._id, expertiseLevel });
        await test.save();

        res.status(200).json({ message: 'Category added successfully', data: test });
      } catch (err) {
        console.error('Error when adding category to test:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir une question par son ID
    this.get('/test/question/:questionId', authenticatedOptions, async (req: any, res: any) => {
      const { questionId } = req.params;
      const question = await TestQuestion.findById(questionId);
      if (!question) {
        return res.status(404).json({ message: 'no question founded with this id' });
      }
      res.status(200).json({ data: question });
    });

    // Obtenir toutes les questions d'un test
    this.get('/test/questions/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;

      try {
        const test = await Test.findById(testId);

        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const questions: any[] = [];
        for (const questionRef of test.questions) {
          // questionRef est maintenant un objet { questionId, categoryId, order }
          const question = await TestQuestion.findById(questionRef.questionId);
          if (question) {
            const questionObj: any = question.toObject();

            // Fonction helper pour convertir en string
            const toString = (id: any): string | null => {
              if (!id) return null;
              if (typeof id === 'string') return id;
              if (id.toString) return id.toString();
              return null;
            };

            // Enrichir la question avec le categoryId depuis test.questions[] si présent
            // Sinon, utiliser le categoryId de la question elle-même
            let categoryId: string | null = null;
            if (questionRef.categoryId) {
              categoryId = toString(questionRef.categoryId);
            } else if (question.categoryId) {
              // Fallback : utiliser le categoryId de la question elle-même
              categoryId = toString(question.categoryId);
            }

            // Log de débogage pour diagnostiquer les problèmes
            if (!categoryId) {
              console.warn(`[GET /test/questions/:testId] Question ${question._id} n'a pas de categoryId:`, {
                questionRefCategoryId: questionRef.categoryId,
                questionCategoryId: question.categoryId,
                questionRef
              });
            }

            // Toujours définir categoryId (même si null, pour que le frontend le détecte)
            questionObj.categoryId = categoryId;

            // Ajouter aussi l'ordre de la question dans le test
            questionObj.order = questionRef.order;
            questions.push(questionObj);
          }
        }
        res.status(200).json({ array: questions });
      } catch (err) {
        console.error('Error when getting question:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Supprimer une question d'un test
    this.delete('/test/question/:testId/:questionId', authenticatedOptions, async (req: any, res: any) => {
      const { testId, questionId } = req.params;
      const question = await TestQuestion.findByIdAndDelete(questionId);
      const test = await Test.findById(testId);
      if (!question) {
        return res.status(404).json({ message: 'no question founded with this id' });
      }
      if (!test) {
        return res.status(404).json({ message: 'no test founded with this id' });
      }
      // Supprimer la question du tableau questions en filtrant par questionId
      test.questions = test.questions.filter(q => q.questionId.toString() !== questionId);

      // Recalculer les ordres pour que ça se suive
      test.questions.forEach((q, index) => {
        q.order = index + 1;
      });

      await test.save();
      res.status(200).json({ message: 'question deleted with sucess' });
    });

    // Supprimer toutes les questions d'un test
    this.delete('/test/questions/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;
      const test = await Test.findById(testId);
      if (!test) {
        return res.status(404).json({ message: 'no test founded with this id' });
      }
      for (const questionId of test.questions) {
        await TestQuestion.findByIdAndDelete(questionId);
      }
      test.questions = [];
      await test.save();
      res.status(200).json({ message: 'questions deleted with sucess' });
    });

    // Modifier une question
    this.put('/test/modifyQuestion/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { instruction, maxScore, time, possibleResponses, textType } = req.body;

      try {
        const question = await TestQuestion.findById(id);
        if (!question) {
          return res.status(404).json({ message: 'no question founded with this id' });
        }
        if (instruction) {
          question.instruction = instruction;
        }
        if (maxScore) {
          question.maxScore = maxScore;
        }
        if (time) {
          question.time = time;
        }
        if (textType) {
          question.textType = textType;
        }

        if (possibleResponses) {
          question.possibleResponses = possibleResponses;
        }
        await question.save();
        res.status(200).json({ message: 'question modified with sucess' });
      } catch (err) {
        console.error('error when modify question : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Ajouter une question à un test
    this.put('/test/addCustomQuestion/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { questionType, instruction, maxScore, time, categoryId } = req.body;

      try {
        if (!categoryId) {
          return res.status(400).json({ message: 'categoryId is required' });
        }

        const test = await Test.findById(id) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        const question = new TestQuestion({
          questionType,
          instruction,
          maxScore,
          time,
          categoryId
        });

        await question.save();

        test.questions.push({
          questionId: question._id,
          categoryId,
          order: test.questions.length
        });
        await test.save();

        res.status(200).json({ message: 'question added in test', test });
      } catch (err) {
        console.error('error when add question in test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Ajouter une question à un test
    this.put('/test/addQuestion/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { questionType, category, expertiseLevel } = req.body;

      try {
        const test = await Test.findById(id) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        // Récupérer la catégorie par son nom pour obtenir l'ID
        const categoryDoc = await TestCategory.findOne({ name: category });
        if (!categoryDoc) {
          return res.status(404).json({ message: 'Category not found' });
        }

        const otherQuestionsIds = test.questions.map(question => question.questionId);
        const otherQuestions = await TestQuestion.find({ _id: { $in: otherQuestionsIds } });

        const jobName = await getJobName(test.targetJob);
        const generatedQuestion = await generateLiveMessageAssistant(
          process.env.OPENAI_ASSISTANT_ID_CREATE_QUESTION || '',
          'createQuestion',
          {
            job: jobName,
            seniority: test.seniorityLevel,
            questionType,
            category,
            expertiseLevel,
            otherQuestions: otherQuestions.map(question => question.instruction).join('\n')
          },
          true
        );

        const questionData = JSON.parse(generatedQuestion);

        console.log('[DEBUG addQuestion] questionData reçu de l\'IA:', JSON.stringify(questionData, null, 2));
        console.log(`[DEBUG addQuestion] Création de question avec categoryId: ${categoryDoc._id.toString()}`);

        // Construire explicitement la question pour s'assurer que categoryId est toujours celui sélectionné
        const questionToCreate: any = {
          questionType: questionData.questionType,
          instruction: questionData.instruction,
          maxScore: questionData.maxScore,
          time: questionData.time,
          textType: questionData.textType || 'text',
          categoryId: categoryDoc._id // TOUJOURS utiliser celui sélectionné
        };

        // Ajouter possibleResponses uniquement si présent
        if (questionData.possibleResponses) {
          questionToCreate.possibleResponses = questionData.possibleResponses;
        }

        const question = new TestQuestion(questionToCreate);
        await question.save();

        console.log(`[DEBUG addQuestion] Question ${question._id} sauvegardée avec categoryId: ${question.categoryId?.toString() || 'MANQUANT'}`);

        test.questions.push({
          questionId: question._id,
          categoryId: categoryDoc._id,
          order: test.questions.length
        });
        await test.save();

        res.status(200).json({ message: 'question added in test', test });
      } catch (err) {
        console.error('error when add question in test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Mélanger les questions d'un test
    this.get('/test/shuffle/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;

      try {
        const test = await Test.findById(testId);

        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        for (let i = test.questions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [test.questions[i], test.questions[j]] = [test.questions[j], test.questions[i]];
        }

        await test.save();

        res.status(200).json({ message: 'Questions shuffled', test });
      } catch (err) {
        console.error('Error when shuffling questions:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Ajouter un texte d'invitation à un test
    this.put('/test/addInvitationText/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { invitationText } = req.body;

      try {
        const test = await Test.findById(id) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        test.invitationText = invitationText;
        await test.save();

        res.status(200).json({
          message: 'invitation text added in test',
          invitationText
        });
      } catch (err) {
        console.error('error when add invitation text in test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir un résultat par son ID
    this.get('/result/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const result = await TestResult.findById(id);

        if (!result) {
          return res.status(404).json({ message: 'no result founded with this id' });
        }

        res.status(200).json({ message: 'result', data: result });
      } catch (err) {
        console.error('error when geting result : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Lister tous les résultats
    this.get('/results/', authenticatedOptions, async (req: any, res: any) => {
      try {
        const results = await TestResult.find();
        if (!results) {
          return res.status(404).json({ message: 'no results founded' });
        }
        res.status(200).json({ array: results });
      } catch (err) {
        console.error('error when geting results : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Créer un résultat
    this.post('/invite', authenticatedOptions, async (req: any, res: any) => {
      const { candidateId, testId } = req.body;

      if (!candidateId || !testId) {
        return res.status(400).json({ message: 'Error, all params are required' });
      }

      try {
        const test = await Test.findById(testId) as ExtendedTest;
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const categories = test.categories.map(cat => ({ categoryId: cat.categoryId }));

        const newResult = new TestResult({
          candidateId,
          testId,
          categories,
          state: 'pending',
          invitationDate: Date.now()
        });
        await newResult.save();

        // Récupérer l'email du candidat
        const candidate = await Candidate.findById(candidateId);
        if (!candidate) {
          return res.status(404).json({ message: 'Candidate not found' });
        }

        // Récupérer le contact pour obtenir l'email
        const contact = await ContactModel.findById(candidate.contact);
        if (!contact) {
          return res.status(404).json({ message: 'Contact not found' });
        }
        const email = contact.email;

        // Construire le lien d'invitation
        const testLink = (process.env.TEST_INVITATION_LINK || '') + email;

        // Récupérer les credentials d'envoi
        const emailUser = process.env.EMAIL_USER;
        const emailPassword = process.env.EMAIL_PASSWORD;

        // Envoyer l'email via l'event emitter
        await emitter.emit(eventTypes.SEND_EMAIL, {
          template: 'test-invitation',
          to: email,
          from: emailUser,
          emailUser,
          emailPassword,
          data: {
            firstname: contact.firstname,
            testName: test?.title || '',
            testLink
          }
        });

        res.status(201).json({ message: 'result created with sucess', data: newResult });
      } catch (err) {
        console.error('error when creating result : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir la question suivante
    this.get('/result/getNextQuestion/:id/:idCurrentQuestion', authenticatedOptions, async (req: any, res: any) => {
      const { id, idCurrentQuestion } = req.params;

      try {
        const result = await TestResult.findById(id);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        const test = await Test.findById(result.testId);
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const questionIndex = test.questions.indexOf(idCurrentQuestion);

        if (questionIndex < test.questions.length) {
          const nextQuestion = test.questions[questionIndex + 1];
          res.status(200).json({ data: nextQuestion });
        } else {
          res.status(200).json({ data: null });
        }
      } catch (err) {
        console.error('error when geting the next question : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Vérifier si c'est la dernière question
    this.get('/result/isLastQuestion/:id/:idCurrentQuestion', authenticatedOptions, async (req: any, res: any) => {
      const { id, idCurrentQuestion } = req.params;

      try {
        const result = await TestResult.findById(id);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        const test = await Test.findById(result.testId);
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const questionIndex = test.questions.indexOf(idCurrentQuestion);

        if (questionIndex === test.questions.length - 1) {
          res.status(200).json({ data: true });
        } else {
          res.status(200).json({ data: false });
        }
      } catch (err) {
        console.error('error when geting the next question : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir une question
    this.get('/result/question/:questionId', authenticatedOptions, async (req: any, res: any) => {
      const { questionId } = req.params;

      try {
        const question = await TestQuestion.findById(questionId);

        if (!question) {
          return res.status(404).json({ message: 'not found' });
        }

        res.status(200).json({ data: question });
      } catch (err) {
        console.error('error when geting the question : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Envoyer une réponse
    this.put('/result/sendResponse/:id/:idCurrentQuestion', authenticatedOptions, async (req: any, res: any) => {
      const { id, idCurrentQuestion } = req.params;
      const { candidateResponse } = req.body;

      try {
        const result = await TestResult.findById(id) as ExtendedResult;
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        const test = await Test.findById(result.testId) as ExtendedTest;
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        if (!result.responses) {
          result.state = 'inProgress';
          result.responses = [];
        }

        result.responses.push({
          questionId: idCurrentQuestion,
          response: candidateResponse,
          score: 0,
          comment: ' '
        });

        await result.save();

        const questionIndex = test.questions.indexOf(idCurrentQuestion);

        if (questionIndex === test.questions.length - 1) {
          emitter.emit(eventTypes.CORRECT_TEST, result);
          result.state = 'finish';
          await result.save();
        }

        res.status(200).json({ response: candidateResponse });
      } catch (err) {
        console.error('error when sending result : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Corriger un test
    this.post('/result/correct/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const result = await TestResult.findById(id);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }
        emitter.emit(eventTypes.CORRECT_TEST, result);
        res.status(200).json({ message: 'Result in correction' });
      } catch (err) {
        console.error('error when correcting result : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Calculer le score
    this.put('/result/calculateScore/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const result = await TestResult.findById(id) as ExtendedResult;
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        result.state = 'finish';
        let finalscore = 0;

        for (const response of result.responses) {
          const question = await TestQuestion.findById(response.questionId);
          if (!question) continue;

          const score = await generateLiveMessageAssistant(
            process.env.OPENAI_ASSISTANT_ID_CORRECT_QUESTION || '',
            'correctQuestion',
            {
              question: {
                _id: question._id.toString(),
                instruction: question.instruction,
                possibleResponses: question.possibleResponses,
                questionType: question.questionType,
                maxScore: question.maxScore
              },
              result: {
                responses: [{
                  questionId: response.questionId.toString(),
                  response: response.response
                }]
              }
            },
            true
          );

          const parsedResult = JSON.parse(score);
          finalscore += parsedResult.score;
          response.score = parsedResult.score;
          response.comment = parsedResult.comment;
        }

        result.score = finalscore;
        await result.save();

        res.status(200).json({ data: finalscore });
      } catch (err) {
        console.error('error when calculate the score : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir le score maximum
    this.get('/maxscore/:resultId', authenticatedOptions, async (req: any, res: any) => {
      const { resultId } = req.params;
      try {
        const result = await TestResult.findById(resultId);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        const test = await Test.findById(result.testId);
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        let maxScore = 0;
        for (const questionId of test.questions) {
          const question = await TestQuestion.findById(questionId);
          if (question) {
            maxScore += question.maxScore;
          }
        }

        res.status(200).json({ data: maxScore });
      } catch (err) {
        console.error('error when geting score : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Obtenir le score d'un résultat
    this.get('/result/score/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const result = await TestResult.findById(id);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        res.status(200).json({ data: result.score });
      } catch (err) {
        console.error('error when geting score : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Générer plusieurs questions pour un test
    this.put('/test/generateQuestions/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { numberOfQuestions, category } = req.body;

      if (!numberOfQuestions || numberOfQuestions <= 0) {
        return res.status(400).json({ message: 'Le nombre de questions doit être positif' });
      }

      try {
        const test = await Test.findById(id) as ExtendedTest;
        if (!test) {
          return res.status(404).json({ message: 'Test non trouvé' });
        }

        let categoriesToUse: { categoryId: string, expertiseLevel: string }[] = [];
        if (category && category !== 'ALL') {
          // Chercher d'abord dans les catégories du test
          const categoryInfo = test.categories.find(cat => cat.categoryId.toString() === category);

          if (categoryInfo) {
            // Catégorie trouvée dans test.categories, utiliser son expertiseLevel
            categoriesToUse = [{
              categoryId: categoryInfo.categoryId.toString(),
              expertiseLevel: categoryInfo.expertiseLevel.toString()
            }];
          } else {
            // Si pas trouvée dans test.categories, chercher directement dans la collection testcategories
            const categoryDoc = await TestCategory.findById(category);
            if (categoryDoc) {
              // Utiliser 'intermediate' comme expertiseLevel par défaut si pas dans test.categories
              categoriesToUse = [{
                categoryId: categoryDoc._id.toString(),
                expertiseLevel: 'intermediate' // Valeur par défaut
              }];
              console.log(`[DEBUG] Catégorie ${categoryDoc.name} trouvée directement dans testcategories`);
            } else {
              return res.status(404).json({ message: `Catégorie avec l'ID ${category} non trouvée` });
            }
          }
        } else {
          // Si category est 'ALL' ou absent, on utilise toutes les catégories du test
          categoriesToUse = test.categories.map(cat => ({
            categoryId: cat.categoryId.toString(),
            expertiseLevel: cat.expertiseLevel.toString()
          }));
        }

        if (categoriesToUse.length === 0) {
          return res.status(400).json({ message: 'Aucune catégorie disponible pour générer des questions' });
        }

        console.log(`[DEBUG] Génération de ${numberOfQuestions} question(s) pour la catégorie:`, categoriesToUse[0]);

        const generatedQuestions: Document[] = [];
        let questionsGenerated = 0;
        let attempts = 0;
        const maxAttempts = numberOfQuestions * 3; // Limite pour éviter les boucles infinies

        // Si on spécifie une catégorie, on génère toutes les questions pour cette catégorie
        if (category && category !== 'ALL') {
          const categoryInfo = categoriesToUse[0];

          while (questionsGenerated < numberOfQuestions && attempts < maxAttempts) {
            attempts++;

            const question = await this.generateAndSaveQuestion(test, categoryInfo, true);
            if (question) {
              generatedQuestions.push(question);
              questionsGenerated++;
            }
          }
        } else {
          // Pour ALL, répartition aléatoire sur toutes les catégories
          const shuffledCategories = [...categoriesToUse].sort(() => Math.random() - 0.5);

          while (questionsGenerated < numberOfQuestions && attempts < maxAttempts) {
            attempts++;

            // Sélectionner une catégorie aléatoire
            const randomCategoryIndex = Math.floor(Math.random() * shuffledCategories.length);
            const categoryInfo = shuffledCategories[randomCategoryIndex];

            const question = await this.generateAndSaveQuestion(test, categoryInfo, true);
            if (question) {
              generatedQuestions.push(question);
              questionsGenerated++;
            }
          }
        }

        // Vérifier qu'au moins une question a été générée
        if (generatedQuestions.length === 0) {
          return res.status(500).json({
            message: 'Aucune question n\'a pu être générée. Veuillez réessayer plus tard.'
          });
        }

        res.status(200).json({
          message: `${generatedQuestions.length} question(s) générée(s) avec succès`,
          questions: generatedQuestions,
          test
        });
      } catch (err) {
        console.error('Erreur lors de la génération des questions : ', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Lister tous les candidats invités à un test
    this.get('/test/:testId/candidates', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      const search = req.query.search as string || '';
      const state = req.query.state as string || 'all';
      const sortBy = req.query.sortBy as string || 'invitationDate';
      const sortOrder = req.query.sortOrder as string || 'desc';

      try {
        const test = await Test.findById(testId);
        if (!test) {
          return res.status(404).json({ message: 'Test non trouvé' });
        }

        // Construction de la requête
        const query: any = { testId };

        if (state !== 'all') {
          query.state = state;
        }

        // Recherche sur les candidats via leurs contacts
        if (search) {
          // D'abord, rechercher dans les contacts
          const contacts = await ContactModel.find({
            $or: [
              { firstname: { $regex: search, $options: 'i' } },
              { lastname: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } }
            ]
          });

          // Ensuite, récupérer les candidats qui ont ces contacts
          const contactIds = contacts.map(c => c._id);
          const candidates = await Candidate.find({
            contact: { $in: contactIds }
          });

          const candidateIds = candidates.map(c => c._id);
          query.candidateId = { $in: candidateIds };
        }

        // Déterminer l'ordre de tri
        const sortDirection = sortOrder === 'asc' ? 1 : -1;

        // Si on trie par lastName, on récupère tous les résultats puis on trie après
        // Sinon on peut trier directement dans la requête MongoDB
        let results, total;

        if (sortBy === 'lastName') {
          // Récupérer tous les résultats sans pagination pour pouvoir trier par lastName
          const allResults = await TestResult.find(query).exec();
          total = allResults.length;

          // Récupérer les données des candidats pour le tri
          const candidateIds = allResults.map(result => result.candidateId);
          const candidates = await Candidate.find({ _id: { $in: candidateIds } });
          const candidatesMap = new Map(candidates.map(c => [c._id.toString(), c]));

          // Combiner les résultats avec les données des candidats et trier
          const resultsWithCandidates = await Promise.all(allResults.map(async result => {
            const candidate = candidatesMap.get(result.candidateId.toString());
            if (!candidate) {
              return {
                ...result.toObject(),
                candidate: null,
                lastName: '',
                maxScore,
                categoryStats: null
              };
            }

            const contact = await ContactModel.findById(candidate.contact);

            // Calculer les statistiques par catégorie
            let categoryStats: { total: { score: number; maxScore: number; percentage: number }; byCategory: any[] } | null = null;
            try {
              const TestQuestionForStats = (await import('../models/test-question.model.js')).default;
              const TestCategoryForStats = (await import('../models/test-category.models.js')).default;
              const resultObj = result.toObject();

              if (test.questions && test.questions.length > 0) {
                const questionIds = test.questions.map((q: any) => q.questionId || q);
                const questions = await TestQuestionForStats.find({ _id: { $in: questionIds } }).lean();

                const responsesMap = new Map(
                  (resultObj.responses || []).map((r: any) => {
                    const questionId = r.questionId?.toString ? r.questionId.toString() : (r.questionId || '').toString();
                    return [questionId, r];
                  })
                );

                const allCategoryIds = Array.from(new Set(questions.map((q: any) => q.categoryId?.toString()).filter(Boolean)));
                const categoriesDocs = await TestCategoryForStats.find({ _id: { $in: allCategoryIds } }).lean();
                const categoriesMap = new Map(categoriesDocs.map(cat => [cat._id.toString(), cat.name]));

                const categoryStatsMap = new Map<string, { score: number; maxScore: number; questionCount: number }>();

                questions.forEach((question: any) => {
                  const categoryId = question.categoryId?.toString();
                  if (!categoryId) return;

                  const response: any = responsesMap.get(question._id.toString());
                  const questionScore = (response?.score as number) || 0;
                  const questionMaxScore = question.maxScore || 0;

                  if (!categoryStatsMap.has(categoryId)) {
                    categoryStatsMap.set(categoryId, { score: 0, maxScore: 0, questionCount: 0 });
                  }

                  const stats = categoryStatsMap.get(categoryId)!;
                  stats.score += questionScore;
                  stats.maxScore += questionMaxScore;
                  stats.questionCount += 1;
                });

                const byCategory = Array.from(categoryStatsMap.entries()).map(([categoryId, stats]) => {
                  const categoryName = categoriesMap.get(categoryId) || 'Catégorie inconnue';
                  const percentage = stats.maxScore > 0 ? Math.round((stats.score / stats.maxScore) * 100) : 0;
                  return {
                    categoryId,
                    categoryName,
                    score: stats.score,
                    maxScore: stats.maxScore,
                    percentage,
                    questionCount: stats.questionCount,
                    totalQuestions: questions.length
                  };
                });

                const totalScore = Array.from(categoryStatsMap.values()).reduce((sum, stats) => sum + stats.score, 0);
                const totalMaxScore = Array.from(categoryStatsMap.values()).reduce((sum, stats) => sum + stats.maxScore, 0);
                const totalPercentage = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;

                categoryStats = {
                  total: { score: totalScore, maxScore: totalMaxScore, percentage: totalPercentage },
                  byCategory
                };
              }
            } catch (err) {
              console.error('Erreur lors du calcul des statistiques par catégorie:', err);
            }

            return {
              ...result.toObject(),
              candidate: contact
                ? {
                  firstName: contact.firstname,
                  lastName: contact.lastname,
                  email: contact.email
                }
                : null,
              lastName: contact ? contact.lastname : '',
              maxScore,
              categoryStats
            };
          }));

          // Trier par lastName
          resultsWithCandidates.sort((a, b) => {
            const lastNameA = (a.lastName || '').toLowerCase();
            const lastNameB = (b.lastName || '').toLowerCase();
            return sortDirection === 1
              ? lastNameA.localeCompare(lastNameB)
              : lastNameB.localeCompare(lastNameA);
          });

          // Appliquer la pagination
          results = resultsWithCandidates.slice(skip, skip + limit);
        } else {
          // Tri direct dans MongoDB pour invitationDate
          const sortObject: any = {};
          sortObject[sortBy] = sortDirection;

          [results, total] = await Promise.all([
            TestResult.find(query)
              .sort(sortObject)
              .skip(skip)
              .limit(limit)
              .exec(),
            TestResult.countDocuments(query)
          ]);
        }

        // Calculer le maxScore du test
        let maxScore = 0;
        if (test.questions && test.questions.length > 0) {
          const questionIds = test.questions.map((q: any) => q.questionId || q);
          const questions = await TestQuestion.find({ _id: { $in: questionIds } }).lean();
          maxScore = questions.reduce((sum, q) => sum + (q.maxScore || 0), 0);
        }

        // Si on a déjà traité les candidats pour le tri par lastName, on utilise directement les résultats
        let resultsWithCandidates;
        if (sortBy === 'lastName') {
          // Les résultats sont déjà traités avec les données des candidats et categoryStats
          resultsWithCandidates = results;
        } else {
          // Récupérer les données des candidats
          const candidateIds = results.map(result => result.candidateId);
          const candidates = await Candidate.find({ _id: { $in: candidateIds } });
          const candidatesMap = new Map(candidates.map(c => [c._id.toString(), c]));

          // Combiner les résultats avec les données des candidats
          resultsWithCandidates = await Promise.all(results.map(async result => {
            const candidate = candidatesMap.get(result.candidateId.toString());
            if (!candidate) {
              return {
                ...result.toObject(),
                candidate: null,
                maxScore,
                categoryStats: null
              };
            }

            // Récupérer le contact pour obtenir les informations personnelles
            const contact = await ContactModel.findById(candidate.contact);
            const resultObj = result.toObject();

            // Calculer les statistiques par catégorie (réutilisation de la logique de result.router)
            let categoryStats: { total: { score: number; maxScore: number; percentage: number }; byCategory: any[] } | null = null;
            try {
              const TestQuestionForStats = (await import('../models/test-question.model.js')).default;
              const TestCategoryForStats = (await import('../models/test-category.models.js')).default;

              if (test.questions && test.questions.length > 0) {
                const questionIds = test.questions.map((q: any) => q.questionId || q);
                const questions = await TestQuestionForStats.find({ _id: { $in: questionIds } }).lean();

                const responsesMap = new Map(
                  (resultObj.responses || []).map((r: any) => {
                    const questionId = r.questionId?.toString ? r.questionId.toString() : (r.questionId || '').toString();
                    return [questionId, r];
                  })
                );

                const allCategoryIds = Array.from(new Set(questions.map((q: any) => q.categoryId?.toString()).filter(Boolean)));
                const categoriesDocs = await TestCategoryForStats.find({ _id: { $in: allCategoryIds } }).lean();
                const categoriesMap = new Map(categoriesDocs.map(cat => [cat._id.toString(), cat.name]));

                const categoryStatsMap = new Map<string, { score: number; maxScore: number; questionCount: number }>();

                questions.forEach((question: any) => {
                  const categoryId = question.categoryId?.toString();
                  if (!categoryId) return;

                  const response: any = responsesMap.get(question._id.toString());
                  const questionScore = (response?.score as number) || 0;
                  const questionMaxScore = question.maxScore || 0;

                  if (!categoryStatsMap.has(categoryId)) {
                    categoryStatsMap.set(categoryId, { score: 0, maxScore: 0, questionCount: 0 });
                  }

                  const stats = categoryStatsMap.get(categoryId)!;
                  stats.score += questionScore;
                  stats.maxScore += questionMaxScore;
                  stats.questionCount += 1;
                });

                const byCategory = Array.from(categoryStatsMap.entries()).map(([categoryId, stats]) => {
                  const categoryName = categoriesMap.get(categoryId) || 'Catégorie inconnue';
                  const percentage = stats.maxScore > 0 ? Math.round((stats.score / stats.maxScore) * 100) : 0;
                  return {
                    categoryId,
                    categoryName,
                    score: stats.score,
                    maxScore: stats.maxScore,
                    percentage,
                    questionCount: stats.questionCount,
                    totalQuestions: questions.length
                  };
                });

                const totalScore = Array.from(categoryStatsMap.values()).reduce((sum, stats) => sum + stats.score, 0);
                const totalMaxScore = Array.from(categoryStatsMap.values()).reduce((sum, stats) => sum + stats.maxScore, 0);
                const totalPercentage = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;

                categoryStats = {
                  total: { score: totalScore, maxScore: totalMaxScore, percentage: totalPercentage },
                  byCategory
                };
              }
            } catch (err) {
              console.error('Erreur lors du calcul des statistiques par catégorie:', err);
            }

            return {
              ...resultObj,
              candidate: contact
                ? {
                  firstName: contact.firstname,
                  lastName: contact.lastname,
                  email: contact.email
                }
                : null,
              maxScore,
              categoryStats
            };
          }));
        }

        const totalPages = Math.ceil(total / limit);

        return res.json({
          data: resultsWithCandidates,
          pagination: {
            currentPage: page,
            totalPages,
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1
          }
        });
      } catch (err) {
        console.error('Erreur lors de la récupération des candidats : ', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Renvoyer l'email d'invitation à un candidat
    this.post('/reinvite/:resultId', authenticatedOptions, async (req: any, res: any) => {
      const { resultId } = req.params;

      try {
        const result = await TestResult.findById(resultId);
        if (!result) {
          return res.status(404).json({ message: 'Result not found' });
        }

        // Récupérer le candidat et son contact
        const candidate = await Candidate.findById(result.candidateId);
        if (!candidate) {
          return res.status(404).json({ message: 'Candidate not found' });
        }

        // Récupérer le contact pour obtenir l'email
        const contact = await ContactModel.findById(candidate.contact);
        if (!contact) {
          return res.status(404).json({ message: 'Contact not found' });
        }

        // Récupérer les informations du test
        const test = await Test.findById(result.testId);
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const email = contact.email;
        const emailUser = process.env.EMAIL_USER;
        const emailPassword = process.env.EMAIL_PASSWORD;

        // Construire le lien d'invitation
        const testLink = (process.env.TEST_INVITATION_LINK || '') + email;

        // Envoyer l'email via l'event emitter
        await emitter.emit(eventTypes.SEND_EMAIL, {
          template: 'test-invitation',
          to: email,
          from: emailUser,
          emailUser,
          emailPassword,
          data: {
            testLink
          }
        });

        // Mettre à jour la date d'invitation
        result.set('invitationDate', new Date());
        await result.save();

        res.status(200).json({ message: 'Invitation email sent successfully' });
      } catch (err) {
        console.error('Error when resending invitation : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Correction manuelle d'une réponse à une question d'un testResult
    this.put('/result/:testResultId/response/:questionId', authenticatedOptions, async (req: any, res: any) => {
      try {
        const { testResultId, questionId } = req.params;
        const { score, comment } = req.body;

        // Récupérer le résultat de test
        const result = await TestResult.findById(testResultId);
        if (!result) {
          return res.status(404).json({ message: 'TestResult non trouvé' });
        }

        // Trouver la réponse à corriger
        const response = (result.responses || []).find((r: any) => r.questionId.toString() === questionId);
        if (!response) {
          return res.status(404).json({ message: 'Réponse à cette question non trouvée dans ce testResult' });
        }

        // Récupérer la question pour vérifier le maxScore
        const question = await TestQuestion.findById(questionId);
        if (!question) {
          return res.status(404).json({ message: 'Question non trouvée' });
        }
        const maxScore = question.maxScore;
        if (typeof score === 'number' && score > maxScore) {
          return res.status(400).json({ message: `Le score ne peut pas dépasser le maximum autorisé (${maxScore}) pour cette question.` });
        }

        // Surcharger le score et le commentaire
        if (typeof score === 'number') response.score = score;
        if (typeof comment === 'string') response.comment = comment;

        // Recalculer le score global
        result.score = (result.responses || []).reduce((sum: number, r: any) => sum + (r.score || 0), 0);
        await result.save();

        return res.status(200).json({
          message: 'Correction manuelle enregistrée',
          response,
          scoreGlobal: result.score
        });
      } catch (err) {
        console.error('Erreur lors de la correction manuelle :', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    // Supprimer un test result
    this.delete('/result/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const testResult = await TestResult.findById(id);
        if (!testResult) {
          return res.status(404).json({ message: 'TestResult not found' });
        }

        await TestResult.findByIdAndDelete(id);
        res.status(200).json({ message: 'TestResult deleted with success' });
      } catch (err) {
        console.error('error when deleting testResult : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    // Migration : Ajouter categoryId aux questions d'un test qui n'en ont pas
    this.post('/test/:id/migrate-category-id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const test = await Test.findById(id) as ExtendedTest;
        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        let migratedQuestions = 0;
        let migratedTestQuestions = 0;
        let errors = 0;
        let testNeedsSave = false;

        // Pour chaque question du test
        for (let i = 0; i < test.questions.length; i++) {
          const questionRef = test.questions[i];
          try {
            const question = await TestQuestion.findById(questionRef.questionId);

            if (!question) continue;

            // Si la question n'a pas de categoryId dans le document TestQuestion
            if (!question.categoryId) {
              // Utiliser le categoryId du test.questions[] s'il existe
              if (questionRef.categoryId) {
                question.categoryId = questionRef.categoryId;
                await question.save();
                migratedQuestions++;
              } else if (test.categories && test.categories.length > 0) {
                // Sinon utiliser la première catégorie du test
                question.categoryId = test.categories[0].categoryId;
                // Aussi mettre à jour test.questions[]
                test.questions[i].categoryId = test.categories[0].categoryId;
                await question.save();
                migratedQuestions++;
                testNeedsSave = true;
              }
            }

            // Si test.questions[] n'a pas de categoryId mais que la question en a un
            if (!questionRef.categoryId && question.categoryId) {
              // Mettre à jour test.questions[]
              test.questions[i].categoryId = question.categoryId;
              testNeedsSave = true;
              migratedTestQuestions++;
            }
          } catch (err) {
            console.error(`Erreur lors de la migration de la question ${questionRef.questionId}:`, err);
            errors++;
          }
        }

        // Sauvegarder le test si des modifications ont été faites
        if (testNeedsSave) {
          await test.save();
        }

        res.status(200).json({
          message: 'Migration terminée',
          migratedQuestions,
          migratedTestQuestions,
          errors,
          total: test.questions.length
        });
      } catch (err) {
        console.error('Erreur lors de la migration:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  }
}

const router = new ExamsRouter();
export default router;
