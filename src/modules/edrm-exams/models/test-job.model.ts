import { Types } from 'mongoose';
import { EnduranceSchema, EnduranceModelType } from '@programisto/endurance';

@EnduranceModelType.modelOptions({
    options: {
        allowMixed: EnduranceModelType.Severity.ALLOW
    }
})
class TestJob extends EnduranceSchema {
    @EnduranceModelType.prop({ required: true })
    public name!: string;

    /**
     * Workspace propriétaire (Lasco). Les entrées sont cherchées et créées dans le workspace de la requête ;
     * sans workspace (usage hors portail), entrées communes comme avant.
     */
    @EnduranceModelType.prop({ type: () => Types.ObjectId, required: false, index: true })
    public workspaceId?: Types.ObjectId;

    public static getModel() {
        return TestJobModel;
    }
}

const TestJobModel = EnduranceModelType.getModelForClass(TestJob);
export default TestJobModel;
