import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance-core';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class Candidate extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public firstName!: string;

    @EnduranceModelType.prop({ required: true })
    public lastName!: string;

    @EnduranceModelType.prop({ required: true, unique: true })
    public email!: string;

    @EnduranceModelType.prop({ required: false, type: String })
    public magicLinkToken?: string;

    @EnduranceModelType.prop({ required: false, type: Date })
    public magicLinkExpiresAt?: Date;

    @EnduranceModelType.prop({ required: false, type: String })
    public authToken?: string;

    @EnduranceModelType.prop({ required: false, type: Date })
    public authTokenExpiresAt?: Date;

    public static getModel() {
        return CandidateModel;
    }
}

const CandidateModel = EnduranceModelType.getModelForClass(Candidate);
export default CandidateModel;
