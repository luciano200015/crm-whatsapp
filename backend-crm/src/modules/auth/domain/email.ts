/**
 * Canonical form used for storage, uniqueness and lookups. Matches the
 * `users_email_normalized_check` constraint in the database.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
