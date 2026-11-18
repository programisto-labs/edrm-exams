/**
 * Boîte d'envoi des e-mails candidat (invitation au test, lien magique).
 *
 * Par défaut : EMAIL_USER / EMAIL_PASSWORD. L'application hôte peut enregistrer un résolveur
 * pour envoyer avec la boîte propre à l'entité (ex. noreply@<domaine de l'entité>).
 * Le résolveur est rangé sur globalThis pour survivre à plusieurs copies du module.
 */
export type CandidateEmailTransport = {
  emailUser?: string;
  emailPassword?: string;
};

export type CandidateEmailTransportResolver = (
  entityId: string
) => Promise<CandidateEmailTransport | null | undefined> | CandidateEmailTransport | null | undefined;

const RESOLVER_KEY = Symbol.for('@programisto/edrm-exams/candidateEmailTransportResolver');

export function setCandidateEmailTransportResolver (resolver: CandidateEmailTransportResolver | null): void {
  (globalThis as any)[RESOLVER_KEY] = resolver ?? undefined;
}

function nonEmpty (value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Identifiants d'envoi pour une entité. Le résolveur n'est retenu que s'il renvoie
 * un utilisateur ET un mot de passe ; sinon repli sur EMAIL_USER / EMAIL_PASSWORD.
 */
export async function resolveCandidateEmailTransport (entityId?: unknown): Promise<CandidateEmailTransport> {
  const fallback: CandidateEmailTransport = {
    emailUser: process.env.EMAIL_USER,
    emailPassword: process.env.EMAIL_PASSWORD
  };
  const resolver = (globalThis as any)[RESOLVER_KEY] as CandidateEmailTransportResolver | undefined;
  const id = entityId != null ? String(entityId) : '';
  if (!resolver || !id) return fallback;
  try {
    const resolved = await resolver(id);
    const emailUser = nonEmpty(resolved?.emailUser);
    const emailPassword = nonEmpty(resolved?.emailPassword);
    if (emailUser && emailPassword) return { emailUser, emailPassword };
  } catch (err) {
    // Jamais d'identifiant ni de mot de passe dans le journal.
    console.error('[edrm-exams] candidate email transport resolver failed', {
      entityId: id,
      error: err instanceof Error ? err.message : String(err)
    });
  }
  return fallback;
}
