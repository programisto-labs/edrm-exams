import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance';

enum QuestionType {
    // eslint-disable-next-line no-unused-vars
    MCQ = 'MCQ',
    // eslint-disable-next-line no-unused-vars
    FreeQuestion = 'free question',
    // eslint-disable-next-line no-unused-vars
    Exercise = 'exercice'
}

interface PossibleResponse {
    possibleResponse: string;
    valid: boolean;
}

enum TextType {
    // eslint-disable-next-line no-unused-vars
    Text = 'text',
    // eslint-disable-next-line no-unused-vars
    Code = 'code'
}

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class TestQuestion extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true, enum: QuestionType })
    public questionType!: QuestionType;

    @EnduranceModelType.prop({ required: true })
    public instruction!: string;

    @EnduranceModelType.prop({ required: true })
    public maxScore!: number;

    @EnduranceModelType.prop({ type: [Object], required: false })
    public possibleResponses!: PossibleResponse[];

    @EnduranceModelType.prop({ required: true })
    public time!: number;

    @EnduranceModelType.prop({ required: false, enum: TextType, default: TextType.Text })
    public textType!: TextType;

    public static getModel() {
        return TestQuestionModel;
    }
}

const TestQuestionModel = EnduranceModelType.getModelForClass(TestQuestion);
export default TestQuestionModel;
