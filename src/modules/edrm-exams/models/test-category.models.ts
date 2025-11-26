import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class TestCategory extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public name!: string;

    public static getModel() {
        return TestCategoryModel;
    }
}

const TestCategoryModel = EnduranceModelType.getModelForClass(TestCategory);
export default TestCategoryModel;
