import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance';
import Company from './company.model.js';
import TestQuestion from './test-question.model.js';
import TestCategory from './test-category.models.js';
import TestJob from './test-job.model.js';
import User from './user.model.js';

enum TestState {
    // eslint-disable-next-line no-unused-vars
    Draft = 'draft',
    // eslint-disable-next-line no-unused-vars
    Published = 'published',
    // eslint-disable-next-line no-unused-vars
    Archived = 'archived'
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

    @EnduranceModelType.prop({ ref: () => TestJob, required: true })
    public targetJob!: typeof TestJob;

    @EnduranceModelType.prop({ required: true, enum: SeniorityLevel })
    public seniorityLevel!: SeniorityLevel;

    public static getModel() {
        return TestModel;
    }

    // Méthode pour migrer automatiquement les anciennes données
    public async migrateTargetJob(): Promise<void> {
        const testData = this as any;

        // Si targetJob est une string (ancien format), on la migre
        if (typeof testData.targetJob === 'string') {
            try {
                // Chercher si le job existe déjà
                let jobType = await TestJob.findOne({ name: testData.targetJob });

                // Si pas trouvé, on le crée
                if (!jobType) {
                    jobType = new TestJob({ name: testData.targetJob });
                    await jobType.save();
                }

                // Mettre à jour la référence
                (this as any).targetJob = jobType._id;
                await this.save();
            } catch (error) {
                console.error('Erreur lors de la migration du targetJob:', error);
            }
        }
    }
}

const TestModel = EnduranceModelType.getModelForClass(Test);
export default TestModel;
