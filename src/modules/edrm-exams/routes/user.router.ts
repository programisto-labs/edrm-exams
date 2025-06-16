import { EnduranceRouter, EnduranceAuthMiddleware, SecurityOptions } from '@programisto/endurance-core';
import User from '../models/user.model.js';

class UserRouter extends EnduranceRouter {
    constructor() {
        super(EnduranceAuthMiddleware.getInstance());
    }

    setupRoutes(): void {
        const authenticatedOptions: SecurityOptions = {
            requireAuth: false,
            permissions: []
        };

        // Lister tous les utilisateurs
        this.get('/', authenticatedOptions, async (req: any, res: any) => {
            try {
                const users = await User.find();
                res.status(200).json({ array: users });
            } catch (err) {
                console.error('Error when retrieving users: ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Créer un utilisateur
        this.post('/create', authenticatedOptions, async (req: any, res: any) => {
            const { firstName, lastName, email, companyId } = req.body;

            if (!firstName || !lastName || !email || !companyId) {
                return res.status(400).json({ message: 'Error, firstName, lastName, email and companyId are required' });
            }

            try {
                const newUser = new User({ firstName, lastName, email, companyId });
                await newUser.save();
                res.status(201).json({ message: 'user created with sucess', user: newUser });
            } catch (err) {
                console.error('error when creating user : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Obtenir un utilisateur par son ID
        this.get('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;

            try {
                const user = await User.findById(id);

                if (!user) {
                    return res.status(404).json({ message: 'no user founded with this id' });
                }

                res.status(200).json({ data: user });
            } catch (err) {
                console.error('error when geting user : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Mettre à jour un utilisateur
        this.put('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;
            const { firstName, lastName, email, companyId } = req.body;

            try {
                const user = await User.findById(id);
                if (!user) {
                    return res.status(404).json({ message: 'no user founded with this id' });
                }

                const updateData = {
                    firstName: firstName || user.firstName,
                    lastName: lastName || user.lastName,
                    email: email || user.email,
                    companyId: companyId || user.companyId
                };

                await User.findByIdAndUpdate(id, updateData, { new: true });
                const updatedUser = await User.findById(id);

                res.status(200).json({ message: 'user updated', user: updatedUser });
            } catch (err) {
                console.error('error when updating user : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // Supprimer un utilisateur
        this.delete('/:id', authenticatedOptions, async (req: any, res: any) => {
            const { id } = req.params;

            try {
                const user = await User.findByIdAndDelete(id);
                if (!user) {
                    return res.status(404).json({ message: 'no user founded with this id' });
                }
                res.status(200).json({ message: 'user deleted', user });
            } catch (err) {
                console.error('error when deleting user : ', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    }
}

const router = new UserRouter();
export default router;
