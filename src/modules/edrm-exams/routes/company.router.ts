import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions } from '@programisto/endurance';
import Company from '../models/company.model.js';
import UserExam from '../models/user.model.js';

interface CompanyData {
    name: string;
    logo: string;
}

class CompanyRouter extends EnduranceRouter {
    constructor() {
        super(EnduranceAuthMiddleware.getInstance());
    }

    setupRoutes(): void {
        const authenticatedOptions: SecurityOptions = {
            requireAuth: false,
            permissions: []
        };

        /**
         * @swagger
         * /companies/{id}:
         *   get:
         *     summary: Détail d'une entreprise
         *     description: Récupère une entreprise par son identifiant.
         *     tags: [Entreprises]
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *     responses:
         *       200:
         *         description: Entreprise trouvée
         *       404:
         *         description: Entreprise non trouvée
         *       500:
         *         description: Erreur interne
         */
        this.get('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;

            try {
                const company = await Company.findById(id);

                if (!company) {
                    return res.status(404).json({ message: 'Aucune entreprise trouvée avec cet ID' });
                }

                res.status(200).json({ data: company });
            } catch (err) {
                console.error('Erreur lors de la récupération de l\'entreprise : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        /**
         * @swagger
         * /companies/create:
         *   post:
         *     summary: Créer une entreprise
         *     description: Crée une nouvelle entreprise avec nom et logo.
         *     tags: [Entreprises]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             required: [name, logo]
         *             properties:
         *               name:
         *                 type: string
         *               logo:
         *                 type: string
         *     responses:
         *       201:
         *         description: Entreprise créée
         *       400:
         *         description: Paramètres manquants
         *       500:
         *         description: Erreur interne
         */
        this.post('/create', authenticatedOptions, async (req: any, res: any) => {
            const { name, logo } = req.body as CompanyData;

            if (!name || !logo) {
                return res.status(400).json({ message: 'Erreur, le nom et le logo sont requis' });
            }

            try {
                const newCompany = new Company({ name, logo });
                await newCompany.save();
                res.status(201).json({ message: 'Entreprise créée avec succès', company: newCompany });
            } catch (err) {
                console.error('Erreur lors de la création de l\'entreprise : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        /**
         * @swagger
         * /companies/{id}:
         *   put:
         *     summary: Mettre à jour une entreprise
         *     description: Met à jour le nom ou le logo d'une entreprise.
         *     tags: [Entreprises]
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
         *               name:
         *                 type: string
         *               logo:
         *                 type: string
         *     responses:
         *       200:
         *         description: Entreprise mise à jour
         *       404:
         *         description: Entreprise non trouvée
         *       500:
         *         description: Erreur interne
         */
        this.put('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;
            const { name, logo } = req.body as CompanyData;

            try {
                const company = await Company.findById(id);

                if (!company) {
                    return res.status(404).json({ message: 'Aucune entreprise trouvée avec cet ID' });
                }

                const updateData = {
                    name: name || company.name,
                    logo: logo || company.logo
                };

                await Company.findByIdAndUpdate(id, updateData, { new: true });
                const updatedCompany = await Company.findById(id);

                res.status(200).json({ message: 'Entreprise mise à jour', company: updatedCompany });
            } catch (err) {
                console.error('Erreur lors de la mise à jour de l\'entreprise : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        /**
         * @swagger
         * /companies/{id}:
         *   delete:
         *     summary: Supprimer une entreprise
         *     description: Supprime une entreprise par son ID.
         *     tags: [Entreprises]
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *     responses:
         *       200:
         *         description: Entreprise supprimée
         *       404:
         *         description: Entreprise non trouvée
         *       500:
         *         description: Erreur interne
         */
        this.delete('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;

            try {
                const company = await Company.findByIdAndDelete(id);
                if (!company) {
                    return res.status(404).json({ message: 'Aucune entreprise trouvée avec cet ID' });
                }
                res.status(200).json({ message: 'Entreprise supprimée', company });
            } catch (err) {
                console.error('Erreur lors de la suppression de l\'entreprise : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        /**
         * @swagger
         * /companies/numberOfUser/{id}:
         *   get:
         *     summary: Nombre d'utilisateurs d'une entreprise
         *     description: Retourne le nombre d'utilisateurs associés à l'entreprise.
         *     tags: [Entreprises]
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         schema:
         *           type: string
         *     responses:
         *       200:
         *         description: Nombre d'utilisateurs retourné
         *       404:
         *         description: Entreprise non trouvée
         *       500:
         *         description: Erreur interne
         */
        this.get('/numberOfUser/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;
            try {
                const users = await UserExam.find({ companyId: id });
                const numberOfUser = users.length;
                res.status(200).json({ data: numberOfUser });
            } catch (err) {
                console.error('Erreur lors de la récupération du nombre d\'utilisateurs : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        /**
         * @swagger
         * /companies:
         *   get:
         *     summary: Lister les entreprises
         *     description: Retourne l'ensemble des entreprises.
         *     tags: [Entreprises]
         *     responses:
         *       200:
         *         description: Liste des entreprises
         *       500:
         *         description: Erreur interne
         */
        this.get('/', authenticatedOptions, async (req: any, res: any) => {
            try {
                const companies = await Company.find();
                res.status(200).json({ array: companies });
            } catch (err) {
                console.error('Erreur lors de la récupération des entreprises : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });
    }
}

const router = new CompanyRouter();
export default router;
