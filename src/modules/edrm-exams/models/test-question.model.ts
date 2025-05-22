import { EnduranceSchema, EnduranceModelType, ObjectId } from 'endurance-core';

enum QuestionType {
    MCQ = 'MCQ',
    FreeQuestion = 'free question',
    Exercise = 'exercice'
}

interface PossibleResponse {
    possibleResponse: string;
    valid: boolean;
}

enum TextType {
    Text = 'text',
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