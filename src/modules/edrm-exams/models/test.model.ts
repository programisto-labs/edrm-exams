import { EnduranceSchema, EnduranceModelType, ObjectId } from 'endurance-core';
import Company from './company.model.js';
import TestQuestion from './test-question.model.js';
import TestCategory from './test-category.models.js';
import User from './user.model.js';
enum TestState {
    Draft = 'draft',
    Published = 'published',
    Archived = 'archived'
}

enum JobType {
    FrontEnd = 'front-end',
    BackEnd = 'back-end',
    Fullstack = 'fullstack',
    DevOps = 'devops',
    Data = 'data'
}

enum SeniorityLevel {
    Student = 'student',
    Junior = 'junior',
    Intermediate = 'intermediate',
    Senior = 'senior'
}

enum ExpertiseLevel {
    Beginner = 'beginner',
    Intermediate = 'intermediate',
    Advanced = 'advanced'
}

interface TestQuestion {
    questionId: typeof TestQuestion;
    order: number;
}

interface TestCategoryWithExpertise {
    categoryId: typeof TestCategory;
    expertiseLevel: ExpertiseLevel;
}

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class Test extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public title!: string;

    @EnduranceModelType.prop({ required: false })
    public description!: string;

    @EnduranceModelType.prop({ ref: () => Company, required: false })
    public companyId!: typeof Company;

    @EnduranceModelType.prop({ ref: () => User, required: false })
    public userId!: typeof User;

    @EnduranceModelType.prop({ type: [Object], required: true })
    public questions!: TestQuestion[];

    @EnduranceModelType.prop({ required: true, enum: TestState, default: TestState.Draft })
    public state!: TestState;

    @EnduranceModelType.prop()
    public duration?: number;

    @EnduranceModelType.prop()
    public passingScore?: number;

    @EnduranceModelType.prop({ type: [Object], required: false })
    public categories?: TestCategoryWithExpertise[];

    @EnduranceModelType.prop({ required: true, enum: JobType })
    public targetJob!: JobType;

    @EnduranceModelType.prop({ required: true, enum: SeniorityLevel })
    public seniorityLevel!: SeniorityLevel;

    public static getModel() {
        return TestModel;
    }
}

const TestModel = EnduranceModelType.getModelForClass(Test);
export default TestModel;