import { Types } from 'mongoose';
import TestJob from '../models/test-job.model.js';

/**
 * Nom du métier visé par un test.
 * `targetJob` peut être un ObjectId, un document peuplé, l'id en texte, ou un nom libre (anciens tests).
 */
export async function getJobName (targetJob: any): Promise<string> {
  if (targetJob == null || targetJob === '') return 'Job inconnu';

  if (typeof targetJob === 'string') {
    const value = targetJob.trim();
    // Id en texte : on cherche le métier, sinon on garde la valeur (nom libre qui ressemblerait à un id).
    if (/^[a-f0-9]{24}$/i.test(value) && Types.ObjectId.isValid(value)) {
      const job = await TestJob.findById(value).lean();
      return (job as any)?.name ?? value;
    }
    return value;
  }

  if (typeof targetJob === 'object') {
    if (typeof (targetJob as any).name === 'string' && (targetJob as any).name.trim() !== '') {
      return (targetJob as any).name;
    }
    const id = (targetJob as any)._id ?? targetJob;
    if (Types.ObjectId.isValid(String(id))) {
      const job = await TestJob.findById(id).lean();
      return (job as any)?.name ?? 'Job inconnu';
    }
  }

  return 'Job inconnu';
}
