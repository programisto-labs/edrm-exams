import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions, enduranceEmitter, enduranceEventTypes } from '@programisto/endurance-core';
import CandidateModel from '../models/candidate.models.js';
import ContactModel from '../models/contact.model.js';
import TestResult from '../models/test-result.model.js';
import Test from '../models/test.model.js';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

interface CandidateData {
    // Informations de contact
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    linkedin?: string;
    city: string;

    // Informations du candidat
    experienceLevel?: string;
    yearsOfExperience?: number;
    skills: string[];
}

class CandidateRouter extends EnduranceRouter {
    constructor() {
        super(EnduranceAuthMiddleware.getInstance());
    }

    setupRoutes(): void {
        const authenticatedOptions: SecurityOptions = {
            requireAuth: false,
            permissions: []
        };

        // Créer un nouveau candidat
        this.post('/', authenticatedOptions, async (req: any, res: any) => {
            const { firstname, lastname, email, phone, linkedin, city, experienceLevel, yearsOfExperience, skills } = req.body as CandidateData;
            console.log(req.body);

            if (!firstname || !lastname || !email || !city || !skills || skills.length === 0) {
                return res.status(400).json({ message: 'Error, firstname, lastname, email, city and skills are required' });
            }

            try {
                // Vérifier si un contact existe déjà avec cette adresse email
                const existingContact = await ContactModel.findOne({ email });

                if (existingContact) {
                    // Vérifier si un candidat existe déjà avec ce contact
                    const existingCandidate = await CandidateModel.findOne({ contact: existingContact._id });

                    if (existingCandidate) {
                        // Contact et candidat existent déjà
                        return res.status(200).json({
                            message: 'Contact et candidat existent déjà avec cette adresse email',
                            status: 'EXISTING',
                            candidate: {
                                ...existingCandidate.toObject(),
                                contact: existingContact.toObject()
                            }
                        });
                    } else {
                        // Le contact existe mais pas de candidat, créer le candidat
                        const newCandidate = new CandidateModel({
                            contact: existingContact._id,
                            experienceLevel: experienceLevel || 'JUNIOR',
                            yearsOfExperience: yearsOfExperience || 0,
                            skills
                        });
                        await newCandidate.save();

                        return res.status(201).json({
                            message: 'Candidat créé avec succès en utilisant le contact existant',
                            status: 'CREATED_WITH_EXISTING_CONTACT',
                            candidate: {
                                ...newCandidate.toObject(),
                                contact: existingContact.toObject()
                            }
                        });
                    }
                }

                // Aucun contact existant, créer le contact et le candidat
                const newContact = new ContactModel({
                    firstname,
                    lastname,
                    email,
                    phone,
                    linkedin,
                    city
                });
                await newContact.save();

                // Créer ensuite le candidat avec la référence au contact
                const newCandidate = new CandidateModel({
                    contact: newContact._id,
                    experienceLevel: experienceLevel || 'JUNIOR',
                    yearsOfExperience: yearsOfExperience || 0,
                    skills
                });
                await newCandidate.save();

                // Récupérer le candidat et le contact séparément
                const candidate = await CandidateModel.findById(newCandidate._id);
                const contact = await ContactModel.findById(newContact._id);

                if (!candidate || !contact) {
                    return res.status(500).json({ message: 'Erreur lors de la récupération des données' });
                }

                res.status(201).json({
                    message: 'Contact et candidat créés avec succès',
                    status: 'CREATED',
                    candidate: {
                        ...candidate.toObject(),
                        contact: contact.toObject()
                    }
                });
            } catch (err) {
                console.error('error when creating candidate : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Lister tous les candidats
        this.get('/', authenticatedOptions, async (req: any, res: any) => {
            try {
                const page = parseInt(req.query.page as string) || 1;
                const limit = parseInt(req.query.limit as string) || 10;
                const skip = (page - 1) * limit;
                const search = req.query.search as string || '';
                const sortBy = req.query.sortBy as string || 'lastname';
                const sortOrder = req.query.sortOrder as string || 'asc';

                let contactIds: Types.ObjectId[] = [];
                let total = 0;

                if (search) {
                    // Recherche dans les contacts
                    const contactQuery = {
                        $or: [
                            { firstname: { $regex: search, $options: 'i' } },
                            { lastname: { $regex: search, $options: 'i' } },
                            { email: { $regex: search, $options: 'i' } }
                        ]
                    };

                    const contacts = await ContactModel.find(contactQuery);
                    contactIds = contacts.map(contact => contact._id);

                    // Compter les candidats avec ces contacts
                    total = await CandidateModel.countDocuments({ contact: { $in: contactIds } });
                } else {
                    // Pas de recherche, compter tous les candidats
                    total = await CandidateModel.countDocuments();
                }

                // Construction du tri pour les contacts
                const allowedSortFields = ['firstname', 'lastname', 'email'];
                const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'lastname';

                let candidates;
                if (search && contactIds.length > 0) {
                    // Récupérer les candidats avec les contacts trouvés
                    candidates = await CandidateModel.find({ contact: { $in: contactIds } })
                        .skip(skip)
                        .limit(limit)
                        .exec();
                } else if (!search) {
                    // Récupérer tous les candidats
                    candidates = await CandidateModel.find()
                        .skip(skip)
                        .limit(limit)
                        .exec();
                } else {
                    // Aucun contact trouvé pour la recherche
                    candidates = [];
                }

                // Récupérer les contacts pour tous les candidats
                const candidateContactIds = candidates.map(candidate => candidate.contact);
                const contacts = await ContactModel.find({ _id: { $in: candidateContactIds } });
                const contactsMap = new Map(contacts.map(contact => [contact._id.toString(), contact]));

                // Combiner les candidats avec leurs contacts et trier
                const candidatesWithContacts = candidates.map(candidate => {
                    const contact = contactsMap.get(candidate.contact.toString());
                    return {
                        ...candidate.toObject(),
                        contact: contact ? contact.toObject() : null
                    };
                });

                // Trier les résultats côté serveur si nécessaire
                if (sortField && candidatesWithContacts.length > 0) {
                    candidatesWithContacts.sort((a, b) => {
                        const aValue = a.contact ? a.contact[sortField] : '';
                        const bValue = b.contact ? b.contact[sortField] : '';

                        if (sortOrder === 'asc') {
                            return aValue.localeCompare(bValue);
                        } else {
                            return bValue.localeCompare(aValue);
                        }
                    });
                }

                const totalPages = Math.ceil(total / limit);

                return res.json({
                    data: candidatesWithContacts,
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
                console.error('error when getting candidates : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Obtenir un candidat par son ID
        this.get('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;

            try {
                const candidate = await CandidateModel.findById(id);

                if (!candidate) {
                    return res.status(404).json({ message: 'no candidate found with this id' });
                }

                // Récupérer le contact associé
                const contact = await ContactModel.findById(candidate.contact);

                if (!contact) {
                    return res.status(404).json({ message: 'contact not found for this candidate' });
                }

                res.status(200).json({
                    message: 'candidate : ',
                    data: {
                        ...candidate.toObject(),
                        contact: contact.toObject()
                    }
                });
            } catch (err) {
                console.error('error when getting candidate : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Obtenir un candidat par son email
        this.get('/email/:email', authenticatedOptions, async (req: any, res: any) => {
            try {
                const email = req.params.email;

                // Chercher d'abord le contact par email
                const contact = await ContactModel.findOne({ email });

                if (!contact) {
                    return res.status(404).json({ message: 'Contact non trouvé' });
                }

                // Puis chercher le candidat avec ce contact
                const candidate = await CandidateModel.findOne({ contact: contact._id });

                if (!candidate) {
                    return res.status(404).json({ message: 'Candidat non trouvé' });
                }

                return res.json({
                    ...candidate.toObject(),
                    contact: contact.toObject()
                });
            } catch (error) {
                console.error('Erreur lors de la récupération du détail du candidat:', error);
                res.status(500).send('Erreur interne du serveur');
            }
        });

        // Générer un lien magique pour le candidat
        this.post('/magic-link', { requireAuth: false }, async (req: any, res: any) => {
            try {
                const { email } = req.body;

                if (!email) {
                    return res.status(400).json({ message: 'Email requis' });
                }

                // Chercher d'abord le contact par email
                const contact = await ContactModel.findOne({ email });
                if (!contact) {
                    return res.status(404).json({ message: 'Contact non trouvé' });
                }

                // Puis chercher le candidat avec ce contact
                const candidate = await CandidateModel.findOne({ contact: contact._id });
                if (!candidate) {
                    return res.status(404).json({ message: 'Candidat non trouvé' });
                }

                // Générer le token JWT
                const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
                const token = jwt.sign(
                    {
                        email,
                        expiresAt: expiresAt.toISOString()
                    },
                    process.env.JWT_SECRET || 'your-secret-key',
                    { expiresIn: '10m' }
                );

                // Mettre à jour le candidat avec le token
                candidate.magicLinkToken = token;
                candidate.magicLinkExpiresAt = expiresAt;
                await candidate.save();

                // Envoyer l'email avec le lien magique
                const magicLink = `${process.env.CANDIDATE_MAGIC_LINK}${token}`;
                await enduranceEmitter.emit(enduranceEventTypes.SEND_EMAIL, {
                    template: 'candidate-magic-link',
                    to: email,
                    from: process.env.EMAIL_USER,
                    emailUser: process.env.EMAIL_USER,
                    emailPassword: process.env.EMAIL_PASSWORD,
                    data: {
                        magicLink
                    }
                });

                return res.json({ message: 'Lien magique envoyé avec succès' });
            } catch (error) {
                console.error('Erreur lors de la génération du lien magique:', error);
                res.status(500).send('Erreur interne du serveur');
            }
        });

        // Vérifier et consommer le token magique
        this.post('/verify-magic-link', { requireAuth: false }, async (req: any, res: any) => {
            try {
                const { token } = req.body;

                if (!token) {
                    return res.status(400).json({ message: 'Token requis' });
                }

                // Vérifier le token JWT
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as { email: string, expiresAt: string };

                // Vérifier si le token n'a pas expiré
                if (new Date(decoded.expiresAt) < new Date()) {
                    return res.status(401).json({ message: 'Token expiré' });
                }

                // Trouver le candidat avec ce token
                const candidate = await CandidateModel.findOne({
                    magicLinkToken: token,
                    magicLinkExpiresAt: { $gt: new Date() }
                });

                if (!candidate) {
                    return res.status(401).json({ message: 'Token invalide ou déjà utilisé' });
                }

                // Consommer le token en le supprimant
                candidate.magicLinkToken = undefined;
                candidate.magicLinkExpiresAt = undefined;

                // Générer un nouveau token d'authentification valide 24h
                const authExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures
                const authToken = jwt.sign(
                    {
                        candidateId: candidate._id.toString(),
                        email: decoded.email,
                        type: 'candidate_auth'
                    },
                    process.env.JWT_SECRET || 'your-secret-key',
                    { expiresIn: '24h' }
                );

                // Sauvegarder le nouveau token
                candidate.authToken = authToken;
                candidate.authTokenExpiresAt = authExpiresAt;
                await candidate.save();

                // Retourner les informations du candidat avec le nouveau token
                return res.json({
                    message: 'Connexion réussie',
                    authToken,
                    candidate: {
                        id: candidate._id,
                        email: decoded.email,
                        contact: candidate.contact
                    }
                });
            } catch (error) {
                if (error instanceof jwt.JsonWebTokenError) {
                    return res.status(401).json({ message: 'Token invalide' });
                }
                console.error('Erreur lors de la vérification du token:', error);
                res.status(500).send('Erreur interne du serveur');
            }
        });

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
                const resultsWithTests = results.map(result => {
                    const test = testsMap.get(result.testId.toString());
                    let categoriesWithNames: any[] = [];
                    if (test && test.categories) {
                        categoriesWithNames = test.categories.map((cat: any) => ({
                            ...cat,
                            categoryName: categoriesMap.get(cat.categoryId?.toString()) || 'Catégorie inconnue'
                        }));
                    }
                    return {
                        ...result,
                        test: test
                            ? {
                                title: test.title,
                                description: test.description,
                                targetJob: test.targetJob,
                                seniorityLevel: test.seniorityLevel,
                                categories: categoriesWithNames
                            }
                            : null
                    };
                });

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
    }
}

const router = new CandidateRouter();
export default router;
