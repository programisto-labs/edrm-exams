import { EnduranceSchema, EnduranceModelType, ObjectId } from '@programisto/endurance';
import Test from './test.model.js';
import User from './user.model.js';

export enum TestState {
    // eslint-disable-next-line no-unused-vars
    Pending = 'pending',
    // eslint-disable-next-line no-unused-vars
    InProgress = 'inProgress',
    // eslint-disable-next-line no-unused-vars
    Finish = 'finish'
}

interface Response {
    questionId: ObjectId;
    response: string;
    score?: number;
    comment?: string;
}

export interface CategoryScore {
    categoryId: ObjectId;
    score: number;
    maxScore: number;
}

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class TestResult extends EnduranceSchema {
    @EnduranceModelType.prop({ ref: () => Test, required: true })
    public testId!: typeof Test;

    @EnduranceModelType.prop({ ref: () => User, required: true })
    public candidateId!: typeof User;

    @EnduranceModelType.prop({ required: true, enum: TestState, default: TestState.Pending })
    public state!: TestState;

    @EnduranceModelType.prop({ type: [Object], required: true })
    public responses!: Response[];

    @EnduranceModelType.prop()
    public score?: number;

    @EnduranceModelType.prop({ type: [Object], required: false })
    public scoresByCategory?: CategoryScore[];

    @EnduranceModelType.prop()
    public startTime?: Date;

    @EnduranceModelType.prop()
    public endTime?: Date;

    public static getModel() {
        return TestResultModel;
    }
}

const TestResultModel = EnduranceModelType.getModelForClass(TestResult);
export default TestResultModel;
