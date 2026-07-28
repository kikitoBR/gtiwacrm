/**
 * Email domain restriction utility.
 * Enforces that all user signups and invitation links are restricted to the
 * official municipal education domain (@edu.campos.rj.gov.br).
 */

export const ALLOWED_EMAIL_DOMAIN = "@edu.campos.rj.gov.br";

export function isAllowedEmailDomain(email: string | undefined | null): boolean {
  if (!email || typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN);
}
