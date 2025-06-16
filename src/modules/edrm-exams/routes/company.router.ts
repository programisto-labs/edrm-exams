import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions } from '@programisto/endurance-core';
import Company from '../models/company.model.js';
import User from '../models/user.model.js';

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

        // Obtenir une entreprise par son ID
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

        // Créer une nouvelle entreprise
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

        // Mettre à jour une entreprise
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

        // Supprimer une entreprise
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

        // Obtenir le nombre d'utilisateurs d'une entreprise
        this.get('/numberOfUser/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;
            try {
                const users = await User.find({ companyId: id });
                const numberOfUser = users.length;
                res.status(200).json({ data: numberOfUser });
            } catch (err) {
                console.error('Erreur lors de la récupération du nombre d\'utilisateurs : ', err);
                res.status(500).json({ message: 'Erreur interne du serveur' });
            }
        });

        // Lister toutes les entreprises
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
