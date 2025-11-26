import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance';
import { Types } from 'mongoose';

// Enum pour les niveaux d'expérience
/* eslint-disable no-unused-vars */
export enum ExperienceLevel {
    JUNIOR = 'JUNIOR',
    INTERMEDIATE = 'INTERMEDIATE',
    SENIOR = 'SENIOR',
    EXPERT = 'EXPERT'
}
/* eslint-enable no-unused-vars */

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class Candidate extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true, ref: 'Contact' })
    public contact!: Types.ObjectId;

    @EnduranceModelType.prop({ required: false, enum: ExperienceLevel, default: ExperienceLevel.JUNIOR })
    public experienceLevel!: string;

    @EnduranceModelType.prop({ required: false, type: Number, default: 0 })
    public yearsOfExperience!: number;

    @EnduranceModelType.prop({ type: [String], required: true })
    public skills!: string[];

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
