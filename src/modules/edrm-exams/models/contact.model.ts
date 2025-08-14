import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance-core';
import { Types } from 'mongoose';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class Contact extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public firstname!: string;

    @EnduranceModelType.prop({ required: true })
    public lastname!: string;

    @EnduranceModelType.prop({ required: true })
    public email!: string;

    @EnduranceModelType.prop()
    public phone?: string;

    @EnduranceModelType.prop()
    public linkedin?: string;

    @EnduranceModelType.prop({ required: true })
    public city!: string;

    @EnduranceModelType.prop({ type: [Types.ObjectId], ref: 'Note', default: [] })
    public notes!: Types.ObjectId[];

    public static getModel() {
        return ContactModel;
    }
}

const ContactModel = EnduranceModelType.getModelForClass(Contact);
export default ContactModel;
