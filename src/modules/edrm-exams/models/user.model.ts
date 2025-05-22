import { EnduranceSchema, EnduranceModelType, ObjectId } from 'endurance-core';
import Company from './company.model.js';

enum UserRole {
    Admin = 'admin',
    Recruiter = 'recruiter',
    Candidate = 'candidate'
}

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class User extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public firstName!: string;

    @EnduranceModelType.prop({ required: true })
    public lastName!: string;

    @EnduranceModelType.prop({ required: true, unique: true })
    public email!: string;

    @EnduranceModelType.prop({ required: true })
    public password!: string;

    @EnduranceModelType.prop({ required: true, enum: UserRole })
    public role!: UserRole;

    @EnduranceModelType.prop({ ref: () => Company })
    public companyId?: typeof Company;

    public static getModel() {
        return UserModel;
    }
}

const UserModel = EnduranceModelType.getModelForClass(User);
export default UserModel;