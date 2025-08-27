import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions, enduranceEmitter, enduranceEventTypes } from '@programisto/endurance-core';
import CandidateModel from '../models/candidate.model.js';
import TestResult, { TestState } from '../models/test-result.model.js';
import Test from '../models/test.model.js';
import TestJob from '../models/test-job.model.js';

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

// eslint-disable-next-line no-unused-vars
interface CandidateData {
    firstName: string;
    lastName: string;
    email: string;
}

class ResultRouter extends EnduranceRouter {
    constructor() {
        super(EnduranceAuthMiddleware.getInstance());
    }

    setupRoutes(): void {
        const authenticatedOptions: SecurityOptions = {
            requireAuth: false,
            permissions: []
        };

        // Lister tous les résultats de tests d'un candidat
        this.get('/results/:candidateId', authenticatedOptions, async (req: any, res: any) => {
            try {
                const { candidateId } = req.params;
                const page = parseInt(req.query.page as string) || 1;
                const limit = parseInt(req.query.limit as string) || 10;
                const skip = (page - 1) * limit;
                const state = req.query.state as string || 'all';
                const sortBy = req.query.sortBy as string || 'invitationDate';
                const sortOrder = req.query.sortOrder as string || 'desc';

                // Vérifier si le candidat existe
                const candidate = await CandidateModel.findById(candidateId);
                if (!candidate) {
                    return res.status(404).json({ message: 'Candidat non trouvé' });
                }

                // Construction de la requête
                const query: any = { candidateId };

                if (state !== 'all') {
                    query.state = state;
                }

                // Construction du tri
                const allowedSortFields = ['invitationDate', 'state', 'score'];
                const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'invitationDate';
                const sortOptions: Record<string, 1 | -1> = {
                    [sortField]: sortOrder === 'asc' ? 1 : -1
                };

                const [results, total] = await Promise.all([
                    TestResult.find(query)
                        .sort(sortOptions)
                        .skip(skip)
                        .limit(limit)
                        .lean()
                        .exec(),
                    TestResult.countDocuments(query)
                ]);

                // Récupérer les informations des tests associés
                const testIds = results.map(result => result.testId);
                const tests = await Test.find({ _id: { $in: testIds } }).lean();
                const testsMap = new Map(tests.map(test => [test._id.toString(), test]));

                // Récupérer tous les IDs de catégories utilisés dans les tests
                const allCategoryIds = Array.from(new Set(
                    tests.flatMap(test => (test.categories || []).map((cat: any) => cat.categoryId?.toString()))
                ));
                const TestCategory = (await import('../models/test-category.models.js')).default;
                const categoriesDocs = await TestCategory.find({ _id: { $in: allCategoryIds } }).lean();
                const categoriesMap = new Map(categoriesDocs.map(cat => [cat._id.toString(), cat.name]));

                // Combiner les résultats avec les informations des tests et des catégories
                const TestQuestion = (await import('../models/test-question.model.js')).default;
                const resultsWithTests = await Promise.all(results.map(async result => {
                    const test = testsMap.get(result.testId.toString());
                    let categoriesWithNames: any[] = [];
                    let maxScore = 0;
                    if (test && test.categories) {
                        categoriesWithNames = test.categories.map((cat: any) => ({
                            ...cat,
                            categoryName: categoriesMap.get(cat.categoryId?.toString()) || 'Catégorie inconnue'
                        }));
                    }
                    if (test && test.questions && test.questions.length > 0) {
                        const questionIds = test.questions.map((q: any) => q.questionId || q);
                        const questions = await TestQuestion.find({ _id: { $in: questionIds } }).lean();
                        maxScore = questions.reduce((sum, q) => sum + (q.maxScore || 0), 0);
                    }
                    const { responses, ...resultWithoutResponses } = result;
                    return {
                        ...resultWithoutResponses,
                        testResultId: result._id,
                        maxScore,
                        test: test
                            ? {
                                title: test.title,
                                description: test.description,
                                targetJob: await getJobName(test.targetJob),
                                seniorityLevel: test.seniorityLevel,
                                categories: categoriesWithNames
                            }
                            : null
                    };
                }));

                const totalPages = Math.ceil(total / limit);

                return res.json({
                    data: resultsWithTests,
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
                console.error('Erreur lors de la récupération des résultats :', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        // Obtenir les infos de base d'un test (sans les questions), avec categoryName et maxTime
        this.get('/test/:id', authenticatedOptions, async (req: any, res: any) => {
            try {
                const { id } = req.params;
                const TestCategory = (await import('../models/test-category.models.js')).default;
                const TestQuestion = (await import('../models/test-question.model.js')).default;

                // Récupérer le test sans les questions
                const test = await Test.findById(id).lean();
                if (!test) {
                    return res.status(404).json({ message: 'Test non trouvé' });
                }

                // Récupérer les noms des catégories
                const categoryIds = (test.categories || []).map((cat: any) => cat.categoryId?.toString());
                const categoriesDocs = await TestCategory.find({ _id: { $in: categoryIds } }).lean();
                const categoriesMap = new Map(categoriesDocs.map(cat => [cat._id.toString(), cat.name]));
                const categoriesWithNames = (test.categories || []).map((cat: any) => ({
                    ...cat,
                    categoryName: categoriesMap.get(cat.categoryId?.toString()) || 'Catégorie inconnue'
                }));

                // Calculer la somme du temps de toutes les questions
                const questions = await TestQuestion.find({ _id: { $in: (test.questions || []).map((q: any) => q.questionId) } }).lean();
                const maxTime = questions.reduce((sum, q) => sum + (q.time || 0), 0);
                const numberOfQuestions = questions.length;

                // Récupérer le nom du job
                const targetJobName = await getJobName(test.targetJob);

                // Construire la réponse sans les questions
                const {
                    questions: _questions, // on retire les questions
                    ...testWithoutQuestions
                } = test;

                return res.json({
                    ...testWithoutQuestions,
                    targetJobName,
                    categories: categoriesWithNames,
                    maxTime,
                    numberOfQuestions
                });
            } catch (err) {
                console.error('Erreur lors de la récupération du test :', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        // Obtenir l'ID de la prochaine question non répondue pour un résultat de test
        this.get('/:id/nextQuestion', authenticatedOptions, async (req: any, res: any) => {
            try {
                const { id } = req.params;
                const { currentQuestionId } = req.query;

                // Récupérer le résultat de test
                const result = await TestResult.findById(id);
                if (!result) {
                    return res.status(404).json({ message: 'Résultat non trouvé' });
                }

                // Récupérer le test associé
                const test = await Test.findById(result.testId).lean();
                if (!test) {
                    return res.status(404).json({ message: 'Test non trouvé' });
                }

                // Liste des questions du test dans l'ordre
                const questions = test.questions || [];

                if (currentQuestionId) {
                    // Si on a un currentQuestionId, on cherche la question suivante dans l'ordre
                    const currentIndex = questions.findIndex(q =>
                        (q.questionId ? q.questionId.toString() : q.toString()) === currentQuestionId
                    );

                    if (currentIndex === -1) {
                        return res.status(404).json({ message: 'Question courante non trouvée' });
                    }

                    // Si c'est la dernière question
                    if (currentIndex === questions.length - 1) {
                        // On est sur la dernière réponse, on met à jour la date de fin
                        result.endTime = new Date();
                        await result.save();
                        return res.json({ nextQuestionId: 'result' });
                    }

                    // Retourner la question suivante
                    const nextQuestion = questions[currentIndex + 1];
                    // Si c'est la première question (currentIndex === -1 avant), on met à jour la date de début
                    if (currentIndex === 0 && !result.startTime) {
                        result.startTime = new Date();
                        await result.save();
                    }
                    return res.json({
                        nextQuestionId: nextQuestion.questionId
                            ? nextQuestion.questionId.toString()
                            : nextQuestion.toString()
                    });
                } else {
                    // Comportement original : chercher la première question non répondue
                    const answeredIds = (result.responses || []).map((r: any) => r.questionId.toString());
                    let nextQuestionId: string | null = null;

                    for (const q of questions) {
                        const qid = (q.questionId ? q.questionId.toString() : q.toString());
                        if (!answeredIds.includes(qid)) {
                            nextQuestionId = qid;
                            break;
                        }
                    }

                    if (!nextQuestionId) {
                        // Plus de question à répondre, on met à jour la date de fin
                        result.endTime = new Date();
                        await result.save();
                        nextQuestionId = 'result';
                    } else if (questions.length > 0 && nextQuestionId === (questions[0].questionId ? questions[0].questionId.toString() : questions[0].toString()) && !result.startTime) {
                        // Si c'est la première question, on met à jour la date de début
                        result.startTime = new Date();
                        await result.save();
                    }

                    return res.json({ nextQuestionId });
                }
            } catch (err) {
                console.error('Erreur lors de la récupération de la prochaine question :', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        // Afficher une question par son ID (optionnellement vérifier la session)
        this.get('/question/:idQuestion', authenticatedOptions, async (req: any, res: any) => {
            try {
                const { idQuestion } = req.params;
                const { sessionId } = req.query;
                const TestQuestion = (await import('../models/test-question.model.js')).default;

                // Récupérer la question
                const question = await TestQuestion.findById(idQuestion).lean();
                if (!question) {
                    return res.status(404).json({ message: 'Question non trouvée' });
                }

                // Optionnel : vérifier que la question appartient bien au test de la session et n'a pas déjà été répondue
                let test: any = null;
                let questionPosition = -1;
                let numberOfQuestions = 0;

                if (sessionId) {
                    const result = await TestResult.findById(sessionId).lean();
                    if (!result) {
                        return res.status(404).json({ message: 'Session (résultat) non trouvée' });
                    }
                    test = await Test.findById(result.testId).lean();
                    if (!test) {
                        return res.status(404).json({ message: 'Test non trouvé' });
                    }
                    const questionIds = (test.questions || []).map((q: any) => q.questionId?.toString());
                    if (!questionIds.includes(idQuestion)) {
                        return res.status(403).json({ message: 'Question non autorisée pour cette session' });
                    }
                    // Vérifier que la question n'a pas déjà été répondue
                    const alreadyAnswered = (result.responses || []).some((r: any) => r.questionId?.toString() === idQuestion);
                    if (alreadyAnswered) {
                        return res.status(403).json({ message: 'Question déjà répondue pour cette session' });
                    }
                } else {
                    // Si pas de sessionId, on doit quand même récupérer le test pour avoir les infos
                    // Chercher dans tous les tests pour trouver celui qui contient cette question
                    const allTests = await Test.find({}).lean();
                    for (const t of allTests) {
                        const questionIds = (t.questions || []).map((q: any) => q.questionId?.toString());
                        if (questionIds.includes(idQuestion)) {
                            test = t;
                            break;
                        }
                    }
                }

                // Calculer la position de la question et le nombre total de questions
                if (test) {
                    numberOfQuestions = test.questions?.length || 0;
                    const questionIndex = test.questions?.findIndex((q: any) => q.questionId?.toString() === idQuestion);
                    questionPosition = questionIndex !== -1 ? questionIndex + 1 : -1; // +1 car les positions commencent à 1
                }

                return res.json({
                    question,
                    numberOfQuestions,
                    questionPosition
                });
            } catch (err) {
                console.error('Erreur lors de la récupération de la question :', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        // Enregistrer la réponse à une question pour un résultat de test
        this.post('/response', authenticatedOptions, async (req: any, res: any) => {
            try {
                const { response, questionId, testResultId } = req.body;

                // Récupérer le résultat de test
                const result = await TestResult.findById(testResultId);
                if (!result) {
                    return res.status(404).json({ message: 'Résultat non trouvé' });
                }

                // Récupérer le test associé
                const test = await Test.findById(result.testId);
                if (!test) {
                    return res.status(404).json({ message: 'Test non trouvé' });
                }

                // Vérifier que la question appartient bien au test
                const questionIds = (test.questions || []).map((q: any) => q.questionId?.toString());
                if (!questionIds.includes(questionId)) {
                    return res.status(403).json({ message: 'Question non autorisée pour ce test' });
                }

                // Vérifier que la question n'a pas déjà été répondue
                const alreadyAnswered = (result.responses || []).some((r: any) => r.questionId?.toString() === questionId);
                if (alreadyAnswered) {
                    return res.status(403).json({ message: 'Question déjà répondue pour cette session' });
                }

                // Enregistrer la réponse
                result.responses = result.responses || [];
                result.responses.push({
                    questionId,
                    response,
                    score: 0,
                    comment: ''
                });

                // Marquer explicitement le champ responses comme modifié
                result.markModified('responses');

                console.log('Avant sauvegarde - Responses:', result.responses);

                // Vérifier si c'était la dernière question
                const totalQuestions = test.questions.length;
                const answeredQuestions = result.responses.length;

                if (answeredQuestions === totalQuestions) {
                    result.state = TestState.Finish;
                } else {
                    result.state = TestState.InProgress;
                }

                // Sauvegarder d'abord la réponse
                const savedResult = await result.save();
                console.log('Après sauvegarde - Responses:', savedResult.responses);

                // Déclencher la correction automatique seulement après la sauvegarde
                if (answeredQuestions === totalQuestions) {
                    await enduranceEmitter.emit(enduranceEventTypes.CORRECT_TEST, savedResult);
                }

                return res.status(200).json({
                    message: 'Réponse enregistrée',
                    response,
                    isLastQuestion: answeredQuestions === totalQuestions
                });
            } catch (err) {
                console.error('Erreur lors de l\'enregistrement de la réponse :', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });
    }
}

const router = new ResultRouter();
export default router;
