/**
 * Retourne la base du lien d'invitation au test technique (portail candidat).
 * Utilise la config de l'entité (testInvitationLink) ou dérive depuis domain/domains.
 * Fallback : process.env.TEST_INVITATION_LINK (ex. https://app.programisto.fr/magic?email=).
 */
export function getTestInvitationLinkBase (entity: { config?: Record<string, string>; domain?: string; domains?: string[] } | null | undefined): string {
  if (!entity) {
    return process.env.TEST_INVITATION_LINK || '';
  }

  const config = (entity as any).config;
  if (config && typeof config.testInvitationLink === 'string' && config.testInvitationLink.trim() !== '') {
    const base = config.testInvitationLink.trim();
    return base.includes('?') ? base : `${base}?email=`;
  }

  const domains = (entity as any).domains;
  if (Array.isArray(domains) && domains.length > 0) {
    const appHost = domains.find((d: string) => String(d).toLowerCase().startsWith('app.'));
    const host = appHost ?? domains[0];
    const base = String(host).toLowerCase().split(':')[0].trim();
    if (base) return `https://${base}/magic?email=`;
  }

  const domain = (entity as any).domain;
  if (domain && String(domain).trim() !== '') {
    const base = String(domain).trim().toLowerCase().replace(/^(my\.|jobs\.|api\.)/, '');
    if (base) return `https://app.${base}/magic?email=`;
  }

  return process.env.TEST_INVITATION_LINK || '';
}
