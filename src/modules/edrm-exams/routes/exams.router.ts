import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions, enduranceEmitter as emitter, enduranceEventTypes as eventTypes } from '@programisto/endurance';
import Test from '../models/test.model.js';
import TestQuestion from '../models/test-question.model.js';
import TestResult from '../models/test-result.model.js';
import TestCategory from '../models/test-category.models.js';
import TestJob from '../models/test-job.model.js';
import Candidate from '../models/candidate.model.js';
import ContactModel from '../models/contact.model.js';
import { generateLiveMessage, generateLiveMessageAssistant } from '../lib/openai.js';
import { Document, Types } from 'mongoose';

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
    useAssistant: boolean = false,
    questionTypeOverride?: string
  ): Promise<Document | null> {
    try {
      const categoryDoc = await TestCategory.findById(categoryInfo.categoryId);
      if (!categoryDoc) {
        console.error('Catégorie non trouvée:', categoryInfo.categoryId);
        return null;
      }

      // Récupérer les questions existantes pour éviter les doublons
      const otherQuestionsIds = test.questions.map(question => question.questionId);
      const otherQuestions = await TestQuestion.find({ _id: { $in: otherQuestionsIds } });

      const jobName = await getJobName(test.targetJob);
      const questionParams = {
        job: jobName,
        seniority: test.seniorityLevel,
        category: categoryDoc.name,
        questionType: (questionTypeOverride && questionTypeOverride !== 'ALL')
          ? questionTypeOverride
          : ['MCQ', 'free question', 'exercice'][Math.floor(Math.random() * 3)],
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
        console.error('Échec de génération de question pour la catégorie:', categoryDoc.name);
        return null;
      }

      const question = new TestQuestion(JSON.parse(generatedQuestion));
      await question.save();

      // Ajouter la question au test et sauvegarder immédiatement
      test.questions.push({ questionId: question._id, order: test.questions.length });
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
    /**
     * @swagger
     * /exams/categories:
     *   post:
     *     summary: Créer une catégorie
     *     description: Crée une catégorie de test avec son nom.
     *     tags: [Examens]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name]
     *             properties:
     *               name:
     *                 type: string
     *     responses:
     *       201:
     *         description: Catégorie créée
     *       400:
     *         description: Paramètres manquants
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/categories:
     *   get:
     *     summary: Lister les catégories
     *     description: Retourne toutes les catégories de test.
     *     tags: [Examens]
     *     responses:
     *       200:
     *         description: Liste des catégories
     *       500:
     *         description: Erreur interne
     */
    this.get('/categories', authenticatedOptions, async (req: any, res: any) => {
      try {
        const categories = await TestCategory.find();
        res.status(200).json({ array: categories });
      } catch (err) {
        console.error('error when creating category : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams/categorie/{id}:
     *   get:
     *     summary: Détail d'une catégorie
     *     description: Récupère une catégorie par son identifiant.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Catégorie trouvée
     *       404:
     *         description: Catégorie non trouvée
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/jobs:
     *   post:
     *     summary: Créer un job cible
     *     description: Crée un job cible pour les tests.
     *     tags: [Examens]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name]
     *             properties:
     *               name:
     *                 type: string
     *     responses:
     *       201:
     *         description: Job créé
     *       400:
     *         description: Paramètres manquants
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/jobs:
     *   get:
     *     summary: Lister les jobs cibles
     *     description: Retourne l'ensemble des jobs disponibles pour les tests.
     *     tags: [Examens]
     *     responses:
     *       200:
     *         description: Liste des jobs
     *       500:
     *         description: Erreur interne
     */
    this.get('/jobs', authenticatedOptions, async (req: any, res: any) => {
      try {
        const jobs = await TestJob.find();
        res.status(200).json({ array: jobs });
      } catch (err) {
        console.error('error when getting jobs : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams/jobs/{id}:
     *   get:
     *     summary: Détail d'un job
     *     description: Récupère un job cible par ID.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Job trouvé
     *       404:
     *         description: Job non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/migrate-targetjobs:
     *   post:
     *     summary: Migrer les tests (targetJob)
     *     description: Convertit les tests utilisant l'ancien format de targetJob vers les références TestJob.
     *     tags: [Examens]
     *     responses:
     *       200:
     *         description: Migration exécutée
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test:
     *   post:
     *     summary: Créer un test
     *     description: Crée un test avec titre, description, job cible, séniorité et catégories.
     *     tags: [Examens]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [title, targetJob, seniorityLevel]
     *             properties:
     *               title:
     *                 type: string
     *               description:
     *                 type: string
     *               targetJob:
     *                 type: string
     *               seniorityLevel:
     *                 type: string
     *               categories:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     name:
     *                       type: string
     *                     expertiseLevel:
     *                       type: string
     *               state:
     *                 type: string
     *     responses:
     *       201:
     *         description: Test créé
     *       400:
     *         description: Paramètres manquants
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/{id}:
     *   put:
     *     summary: Modifier un test
     *     description: Met à jour les métadonnées, catégories ou questions d'un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *     responses:
     *       200:
     *         description: Test modifié
     *       404:
     *         description: Test non trouvé
     *       400:
     *         description: Données invalides
     *       500:
     *         description: Erreur interne
     */
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

          // Mettre à jour les questions avec leur ordre
          test.questions = questions.map((q: any) => ({
            questionId: q.questionId,
            order: q.order || 0
          }));
        }

        await test.save();
        res.status(200).json({ message: 'Test modifié avec succès', data: test });
      } catch (err) {
        console.error('Erreur lors de la modification du test : ', err);
        res.status(500).json({ message: 'Erreur interne du serveur' });
      }
    });

    /**
     * @swagger
     * /exams/test/{id}:
     *   delete:
     *     summary: Supprimer un test
     *     description: Supprime un test ainsi que ses questions et résultats associés.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Test supprimé
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/{id}:
     *   get:
     *     summary: Détail d'un test
     *     description: Retourne un test avec ses questions et nom du job cible.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Test trouvé
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
    this.get('/test/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;

      try {
        const test = await Test.findById(id);

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        // Migration automatique si nécessaire
        await migrateTestIfNeeded(test);

        const questions: Document[] = [];
        for (const questionRef of test.questions) {
          console.log(questionRef);
          const question = await TestQuestion.findById(questionRef.questionId);
          if (question) {
            console.log(question);
            questions.push(question);
          }
        }

        // Récupérer le nom du job pour l'affichage
        const testObj = test.toObject();
        (testObj as any).targetJobName = await getJobName(testObj.targetJob);

        res.status(200).json({ test: testObj, questions });
      } catch (err) {
        console.error('error when geting test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams:
     *   get:
     *     summary: Lister les tests
     *     description: Liste paginée des tests avec filtres, recherche et tri.
     *     tags: [Examens]
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           default: 1
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *       - in: query
     *         name: search
     *         schema:
     *           type: string
     *       - in: query
     *         name: targetJob
     *         schema:
     *           type: string
     *           default: all
     *       - in: query
     *         name: seniorityLevel
     *         schema:
     *           type: string
     *           default: all
     *       - in: query
     *         name: state
     *         schema:
     *           type: string
     *           default: all
     *       - in: query
     *         name: sortBy
     *         schema:
     *           type: string
     *           default: updatedAt
     *       - in: query
     *         name: sortOrder
     *         schema:
     *           type: string
     *           default: desc
     *     responses:
     *       200:
     *         description: Tests paginés
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/removeCategory/{testId}:
     *   delete:
     *     summary: Retirer une catégorie d'un test
     *     description: Supprime une catégorie d'un test par son nom.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               categoryName:
     *                 type: string
     *     responses:
     *       200:
     *         description: Catégorie supprimée
     *       404:
     *         description: Test ou catégorie non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/addCategory/{testId}:
     *   put:
     *     summary: Ajouter une catégorie à un test
     *     description: Ajoute une catégorie (créée si besoin) à un test avec niveau d'expertise.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               categoryName:
     *                 type: string
     *               expertiseLevel:
     *                 type: string
     *     responses:
     *       200:
     *         description: Catégorie ajoutée
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/question/{questionId}:
     *   get:
     *     summary: Détail d'une question
     *     description: Retourne une question de test par son identifiant.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: questionId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Question trouvée
     *       404:
     *         description: Question non trouvée
     *       500:
     *         description: Erreur interne
     */
    this.get('/test/question/:questionId', authenticatedOptions, async (req: any, res: any) => {
      const { questionId } = req.params;
      const question = await TestQuestion.findById(questionId);
      if (!question) {
        return res.status(404).json({ message: 'no question founded with this id' });
      }
      res.status(200).json({ data: question });
    });

    /**
     * @swagger
     * /exams/test/questions/{testId}:
     *   get:
     *     summary: Lister les questions d'un test
     *     description: Retourne toutes les questions d'un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Questions retournées
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
    this.get('/test/questions/:testId', authenticatedOptions, async (req: any, res: any) => {
      const { testId } = req.params;

      try {
        const test = await Test.findById(testId);

        if (!test) {
          return res.status(404).json({ message: 'Test not found' });
        }

        const questions: Document[] = [];
        for (const questionId of test.questions) {
          const question = await TestQuestion.findById(questionId);
          if (question) {
            questions.push(question);
          }
        }
        res.status(200).json({ array: questions });
      } catch (err) {
        console.error('Error when getting question:', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams/test/question/{testId}/{questionId}:
     *   delete:
     *     summary: Supprimer une question d'un test
     *     description: Supprime une question spécifique et réordonne les questions restantes.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: questionId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Question supprimée
     *       404:
     *         description: Test ou question non trouvés
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/questions/{testId}:
     *   delete:
     *     summary: Supprimer toutes les questions d'un test
     *     description: Supprime toutes les questions associées à un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Questions supprimées
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/modifyQuestion/{id}:
     *   put:
     *     summary: Modifier une question
     *     description: Met à jour les champs d'une question (texte, score, temps, réponses possibles).
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *     responses:
     *       200:
     *         description: Question modifiée
     *       404:
     *         description: Question non trouvée
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/addCustomQuestion/{id}:
     *   put:
     *     summary: Ajouter une question personnalisée
     *     description: Ajoute une question manuelle à un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               questionType:
     *                 type: string
     *               instruction:
     *                 type: string
     *               maxScore:
     *                 type: number
     *               time:
     *                 type: number
     *     responses:
     *       200:
     *         description: Question ajoutée
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
    this.put('/test/addCustomQuestion/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { questionType, instruction, maxScore, time } = req.body;

      try {
        const test = await Test.findById(id) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
        }

        const question = new TestQuestion({
          questionType,
          instruction,
          maxScore,
          time
        });

        await question.save();

        test.questions.push({ questionId: question._id, order: test.questions.length });
        await test.save();

        res.status(200).json({ message: 'question added in test', test });
      } catch (err) {
        console.error('error when add question in test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams/test/addQuestion/{id}:
     *   put:
     *     summary: Générer et ajouter une question
     *     description: Génère une question via assistant et l'ajoute au test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               questionType:
     *                 type: string
     *               category:
     *                 type: string
     *               expertiseLevel:
     *                 type: string
     *     responses:
     *       200:
     *         description: Question générée et ajoutée
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
    this.put('/test/addQuestion/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { questionType, category, expertiseLevel } = req.body;

      try {
        const test = await Test.findById(id) as ExtendedTest;

        if (!test) {
          return res.status(404).json({ message: 'no test founded with this id' });
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

        const question = new TestQuestion(JSON.parse(generatedQuestion));
        await question.save();

        test.questions.push({ questionId: question._id, order: test.questions.length });
        await test.save();

        res.status(200).json({ message: 'question added in test', test });
      } catch (err) {
        console.error('error when add question in test : ', err);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    /**
     * @swagger
     * /exams/test/shuffle/{testId}:
     *   get:
     *     summary: Mélanger les questions d'un test
     *     description: Mélange l'ordre des questions d'un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Questions mélangées
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/addInvitationText/{id}:
     *   put:
     *     summary: Ajouter un texte d'invitation
     *     description: Ajoute ou met à jour le texte d'invitation utilisé pour un test.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               invitationText:
     *                 type: string
     *     responses:
     *       200:
     *         description: Texte mis à jour
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/{id}:
     *   get:
     *     summary: Détail d'un résultat
     *     description: Retourne un TestResult par identifiant.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Résultat trouvé
     *       404:
     *         description: Résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/results/:
     *   get:
     *     summary: Lister les résultats
     *     description: Retourne tous les résultats existants.
     *     tags: [Résultats]
     *     responses:
     *       200:
     *         description: Liste des résultats
     *       404:
     *         description: Aucun résultat
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/invite:
     *   post:
     *     summary: Inviter un candidat à un test
     *     description: Crée un TestResult et envoie un email d'invitation au candidat.
     *     tags: [Résultats]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [candidateId, testId]
     *             properties:
     *               candidateId:
     *                 type: string
     *               testId:
     *                 type: string
     *     responses:
     *       201:
     *         description: Invitation créée
     *       404:
     *         description: Test ou candidat non trouvé
     *       400:
     *         description: Paramètres manquants
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/getNextQuestion/{id}/{idCurrentQuestion}:
     *   get:
     *     summary: Obtenir la question suivante
     *     description: Retourne la prochaine question pour un TestResult ou null s'il n'y en a plus.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: idCurrentQuestion
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Prochaine question ou null
     *       404:
     *         description: Résultat ou test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/isLastQuestion/{id}/{idCurrentQuestion}:
     *   get:
     *     summary: Vérifier la dernière question
     *     description: Indique si la question courante est la dernière du test.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: idCurrentQuestion
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Booléen retourné
     *       404:
     *         description: Résultat ou test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/question/{questionId}:
     *   get:
     *     summary: Obtenir une question (résultat)
     *     description: Retourne une question via son identifiant pour un résultat.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: questionId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Question trouvée
     *       404:
     *         description: Question non trouvée
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/sendResponse/{id}/{idCurrentQuestion}:
     *   put:
     *     summary: Envoyer une réponse
     *     description: Enregistre la réponse d'un candidat pour une question d'un test.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: idCurrentQuestion
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               candidateResponse:
     *                 type: string
     *     responses:
     *       200:
     *         description: Réponse enregistrée
     *       404:
     *         description: Test ou résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/correct/{id}:
     *   post:
     *     summary: Lancer la correction d'un test
     *     description: Déclenche la correction d'un TestResult.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Correction lancée
     *       404:
     *         description: Résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/calculateScore/{id}:
     *   put:
     *     summary: Calculer le score
     *     description: Calcule et enregistre le score final d'un TestResult.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Score calculé
     *       404:
     *         description: Résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/maxscore/{resultId}:
     *   get:
     *     summary: Obtenir le score maximum
     *     description: Calcule le score maximal possible pour un résultat.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: resultId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Score maximum retourné
     *       404:
     *         description: Résultat ou test non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/score/{id}:
     *   get:
     *     summary: Obtenir le score d'un résultat
     *     description: Retourne le score calculé d'un TestResult.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Score retourné
     *       404:
     *         description: Résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/test/generateQuestions/{id}:
     *   put:
     *     summary: Générer des questions pour un test
     *     description: Génère plusieurs questions (IA) pour un test donné, éventuellement filtrées par catégorie et type.
     *     tags: [Examens]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [numberOfQuestions]
     *             properties:
     *               numberOfQuestions:
     *                 type: integer
     *               category:
     *                 type: string
     *               questionType:
     *                 type: string
     *     responses:
     *       200:
     *         description: Questions générées
     *       400:
     *         description: Paramètres invalides
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
    this.put('/test/generateQuestions/:id', authenticatedOptions, async (req: any, res: any) => {
      const { id } = req.params;
      const { numberOfQuestions, category, questionType } = req.body;

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
          const categoryInfo = test.categories.find(cat => cat.categoryId.toString() === category);
          if (categoryInfo) {
            categoriesToUse = [{
              categoryId: categoryInfo.categoryId.toString(),
              expertiseLevel: categoryInfo.expertiseLevel.toString()
            }];
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

        const generatedQuestions: Document[] = [];
        let questionsGenerated = 0;
        let attempts = 0;
        const maxAttempts = numberOfQuestions * 3; // Limite pour éviter les boucles infinies

        // Si on spécifie une catégorie, on génère toutes les questions pour cette catégorie
        if (category && category !== 'ALL') {
          const categoryInfo = categoriesToUse[0];

          while (questionsGenerated < numberOfQuestions && attempts < maxAttempts) {
            attempts++;

            const question = await this.generateAndSaveQuestion(test, categoryInfo, true, questionType);
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

            const question = await this.generateAndSaveQuestion(test, categoryInfo, true, questionType);
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

    /**
     * @swagger
     * /exams/test/{testId}/candidates:
     *   get:
     *     summary: Lister les candidats invités
     *     description: Liste paginée des candidats invités à un test avec filtres et tri.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: testId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           default: 1
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *       - in: query
     *         name: search
     *         schema:
     *           type: string
     *       - in: query
     *         name: state
     *         schema:
     *           type: string
     *           default: all
     *       - in: query
     *         name: sortBy
     *         schema:
     *           type: string
     *           default: invitationDate
     *       - in: query
     *         name: sortOrder
     *         schema:
     *           type: string
     *           default: desc
     *     responses:
     *       200:
     *         description: Candidats paginés
     *       404:
     *         description: Test non trouvé
     *       500:
     *         description: Erreur interne
     */
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
                lastName: ''
              };
            }

            const contact = await ContactModel.findById(candidate.contact);
            return {
              ...result.toObject(),
              candidate: contact
                ? {
                  firstName: contact.firstname,
                  lastName: contact.lastname,
                  email: contact.email
                }
                : null,
              lastName: contact ? contact.lastname : ''
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
          // Les résultats sont déjà traités avec les données des candidats
          resultsWithCandidates = results.map(result => ({
            ...result,
            maxScore
          }));
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
                maxScore
              };
            }

            // Récupérer le contact pour obtenir les informations personnelles
            const contact = await ContactModel.findById(candidate.contact);
            return {
              ...result.toObject(),
              candidate: contact
                ? {
                  firstName: contact.firstname,
                  lastName: contact.lastname,
                  email: contact.email
                }
                : null,
              maxScore
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

    /**
     * @swagger
     * /exams/reinvite/{resultId}:
     *   post:
     *     summary: Renvoyer une invitation
     *     description: Récupère un TestResult et renvoie l'email d'invitation.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: resultId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Invitation renvoyée
     *       404:
     *         description: Ressource non trouvée
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/{testResultId}/response/{questionId}:
     *   put:
     *     summary: Correction manuelle d'une réponse
     *     description: Met à jour le score/commentaire d'une réponse et recalcule le score global.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: testResultId
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: questionId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               score:
     *                 type: number
     *               comment:
     *                 type: string
     *     responses:
     *       200:
     *         description: Correction enregistrée
     *       404:
     *         description: Ressource non trouvée
     *       400:
     *         description: Score invalide
     *       500:
     *         description: Erreur interne
     */
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

    /**
     * @swagger
     * /exams/result/{id}:
     *   delete:
     *     summary: Supprimer un résultat
     *     description: Supprime un TestResult.
     *     tags: [Résultats]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Résultat supprimé
     *       404:
     *         description: Résultat non trouvé
     *       500:
     *         description: Erreur interne
     */
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
  }
}

const router = new ExamsRouter();
export default router;
