import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance-core';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class TestJob extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public name!: string;

    public static getModel() {
        return TestJobModel;
    }
}

const TestJobModel = EnduranceModelType.getModelForClass(TestJob);
export default TestJobModel;
