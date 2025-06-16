import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance-core';
import Company from './company.model.js';
import TestQuestion from './test-question.model.js';
import TestCategory from './test-category.models.js';
import User from './user.model.js';

enum TestState {
    // eslint-disable-next-line no-unused-vars
    Draft = 'draft',
    // eslint-disable-next-line no-unused-vars
    Published = 'published',
    // eslint-disable-next-line no-unused-vars
    Archived = 'archived'
}

enum JobType {
    // eslint-disable-next-line no-unused-vars
    FrontEnd = 'front-end',
    // eslint-disable-next-line no-unused-vars
    BackEnd = 'back-end',
    // eslint-disable-next-line no-unused-vars
    Fullstack = 'fullstack',
    // eslint-disable-next-line no-unused-vars
    DevOps = 'devops',
    // eslint-disable-next-line no-unused-vars
    Data = 'data'
}

enum SeniorityLevel {
    // eslint-disable-next-line no-unused-vars
    Student = 'student',
    // eslint-disable-next-line no-unused-vars
    Junior = 'junior',
    // eslint-disable-next-line no-unused-vars
    Intermediate = 'intermediate',
    // eslint-disable-next-line no-unused-vars
    Senior = 'senior'
}

enum ExpertiseLevel {
    // eslint-disable-next-line no-unused-vars
    Beginner = 'beginner',
    // eslint-disable-next-line no-unused-vars
    Intermediate = 'intermediate',
    // eslint-disable-next-line no-unused-vars
    Advanced = 'advanced'
}

interface TestQuestions {
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
    public questions!: TestQuestions[];

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
