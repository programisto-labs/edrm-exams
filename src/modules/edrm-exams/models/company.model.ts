import { EnduranceSchema, EnduranceModelType } from 'endurance-core';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class Company extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public name!: string;

    @EnduranceModelType.prop({ required: true })
    public logo!: string;

    public static getModel() {
        return CompanyModel;
    }
}

const CompanyModel = EnduranceModelType.getModelForClass(Company);
export default CompanyModel;
