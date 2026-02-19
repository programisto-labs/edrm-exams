import { Types } from 'mongoose';
import { enduranceListener, enduranceEmitter, enduranceEventTypes } from '@programisto/endurance';
import Test from '../models/test.model.js';
import TestResult from '../models/test-result.model.js';
import Candidate from '../models/candidate.model.js';
import ContactModel from '../models/contact.model.js';

const EVENT_INVITE_TO_TECHNICAL_TEST = 'INVITE_TO_TECHNICAL_TEST';

interface InvitePayload {
  candidateId: string | { toString: () => string };
  testId: string | { toString: () => string };
  /** Identifiant de l'entité pour utiliser le template mail de l'entité (ex. École de Turing). */
  entityId?: Types.ObjectId | string;
}

/**
 * Même logique que POST /exams/invite : crée un TestResult et envoie l'email d'invitation.
 * Déclenché quand une candidature est créée sur une offre avec un test lié (internal-portal).
 */
async function inviteCandidateToTest (payload: InvitePayload): Promise<void> {
  const candidateId = typeof payload.candidateId === 'object' && payload.candidateId?.toString
    ? payload.candidateId.toString()
    : String(payload.candidateId ?? '');
  const testId = typeof payload.testId === 'object' && payload.testId?.toString
    ? payload.testId.toString()
    : String(payload.testId ?? '');

  if (!candidateId || !testId) return;

  const existing = await TestResult.findOne({ candidateId, testId });
  if (existing) {
    return;
  }

  const test = await Test.findById(testId);
  if (!test) {
    console.warn('[INVITE_TO_TECHNICAL_TEST] Test not found:', testId);
    return;
  }

  const categories = (test as any).categories?.map((cat: any) => ({ categoryId: cat.categoryId })) ?? [];

  const newResult = new TestResult({
    candidateId,
    testId,
    categories,
    state: 'pending',
    invitationDate: Date.now()
  });
  await newResult.save();

  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    console.warn('[INVITE_TO_TECHNICAL_TEST] Candidate not found:', candidateId);
    return;
  }

  const contact = await ContactModel.findById(candidate.contact);
  if (!contact) {
    console.warn('[INVITE_TO_TECHNICAL_TEST] Contact not found for candidate:', candidateId);
    return;
  }

  const email = (contact as any).email;
  if (!email) {
    console.warn('[INVITE_TO_TECHNICAL_TEST] No email for contact');
    return;
  }

  const testLink = (process.env.TEST_INVITATION_LINK || '') + email;
  const emailUser = process.env.EMAIL_USER;
  const emailPassword = process.env.EMAIL_PASSWORD;

  const entityIdForMail = (payload as InvitePayload).entityId != null
    ? ((payload as InvitePayload).entityId instanceof Types.ObjectId
        ? (payload as InvitePayload).entityId
        : new Types.ObjectId(String((payload as InvitePayload).entityId)))
    : undefined;

  await enduranceEmitter.emit(enduranceEventTypes.SEND_EMAIL, {
    template: 'test-invitation',
    to: email,
    from: emailUser,
    emailUser,
    emailPassword,
    ...(entityIdForMail && { entityId: entityIdForMail }),
    data: {
      firstname: (contact as any).firstname,
      testName: (test as any)?.title || '',
      testLink
    }
  });
}

enduranceListener.createListener(EVENT_INVITE_TO_TECHNICAL_TEST, async (args: unknown) => {
  try {
    if (typeof args === 'object' && args !== null) {
      await inviteCandidateToTest(args as InvitePayload);
    }
  } catch (err) {
    console.error('[INVITE_TO_TECHNICAL_TEST] Error inviting candidate to test:', err);
  }
});

export default enduranceListener;
