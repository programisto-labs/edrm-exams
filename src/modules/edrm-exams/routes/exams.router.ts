import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions, enduranceEmitter as emitter, enduranceEventTypes as eventTypes } from '@programisto/endurance-core';
import Test from '../models/test.model.js';
import TestQuestion from '../models/test-question.model.js';
import TestResult from '../models/test-result.model.js';
import TestCategory from '../models/test-category.models.js';
import Candidate from '../models/candidate.model.js';
import ContactModel from '../models/contact.model.js';
import { generateLiveMessage } from '../lib/openai.js';
import { Document, Types } from 'mongoose';

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
          targetJob,
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
      const { title, description, targetJob, seniorityLevel, categories, state } = req.body;

      try {
        const test = await Test.findById(id);
        if (!test) {
          return res.status(404).json({ message: 'Test non trouvé' });
        }

        if (title) test.title = title;
        if (description) test.description = description;
        if (targetJob) test.targetJob = targetJob;
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
          await TestQuestion.findByIdAndDelete(test.questions[i]);
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

        const questions: Document[] = [];
        for (const questionRef of test.questions) {
          console.log(questionRef);
          const question = await TestQuestion.findById(questionRef.questionId);
          if (question) {
            console.log(question);
            questions.push(question);
          }
        }
        res.status(200).json({ test, questions });
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
          query.targetJob = targetJob;
        }
        if (seniorityLevel !== 'all') {
          query.seniorityLevel = seniorityLevel;
        }
        if (state !== 'all') {
          query.state = state;
        }

        // Recherche sur testName et targetJob
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { targetJob: { $regex: search, $options: 'i' } },
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

        // Récupérer les noms des catégories pour chaque test
        const testsWithCategories = await Promise.all(tests.map(async (test) => {
          const testObj = test.toObject();
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

    // Ajouter une question à un test
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

        const generatedQuestion = await generateLiveMessage(
          'createQuestion',
          {
            job: test.targetJob,
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

          const score = await generateLiveMessage(
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

        // Mélanger les catégories pour une répartition aléatoire
        const shuffledCategories = [...categoriesToUse].sort(() => Math.random() - 0.5);

        for (const categoryInfo of shuffledCategories) {
          // Arrêter si on a déjà généré le nombre de questions demandé
          if (questionsGenerated >= numberOfQuestions) break;

          const categoryDoc = await TestCategory.findById(categoryInfo.categoryId);
          if (!categoryDoc) continue;

          const otherQuestionsIds = test.questions.map(question => question.questionId);
          const otherQuestions = await TestQuestion.find({ _id: { $in: otherQuestionsIds } });

          // Calculer combien de questions générer pour cette catégorie
          const remainingQuestions = numberOfQuestions - questionsGenerated;
          const questionsForThisCategory = Math.min(remainingQuestions, Math.ceil(numberOfQuestions / categoriesToUse.length));

          for (let i = 0; i < questionsForThisCategory; i++) {
            const generatedQuestion = await generateLiveMessage(
              'createQuestion',
              {
                job: test.targetJob,
                seniority: test.seniorityLevel,
                category: categoryDoc.name,
                questionType: ['MCQ', 'free question', 'exercice'][Math.floor(Math.random() * 3)],
                expertiseLevel: categoryInfo.expertiseLevel,
                otherQuestions: otherQuestions.map(question => question.instruction).join('\n')
              },
              true
            );

            // Vérifier si la réponse est un JSON valide
            if (generatedQuestion === 'Brain freezed, I cannot generate a live message right now.') {
              console.error('Échec de génération de question pour la catégorie:', categoryDoc.name);
              continue; // Passer à la question suivante
            }

            try {
              const question = new TestQuestion(JSON.parse(generatedQuestion));
              await question.save();
              generatedQuestions.push(question);
              test.questions.push({ questionId: question._id, order: test.questions.length });
              questionsGenerated++;
            } catch (parseError) {
              console.error('Erreur lors du parsing de la question générée:', parseError);
              console.error('Réponse reçue:', generatedQuestion);
              continue; // Passer à la question suivante
            }
          }
        }

        // Vérifier qu'au moins une question a été générée
        if (generatedQuestions.length === 0) {
          return res.status(500).json({
            message: 'Aucune question n\'a pu être générée. Veuillez réessayer plus tard.'
          });
        }

        await test.save();
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
  }
}

const router = new ExamsRouter();
export default router;
