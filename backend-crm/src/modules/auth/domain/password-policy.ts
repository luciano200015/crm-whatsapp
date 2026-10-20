/**
 * Password policy (NIST SP 800-63B style): length over composition rules.
 * - 12 to 128 characters (Unicode code points, after NFKC normalization).
 * - Not the user's email or its local part.
 * - Not a trivially weak value (single repeated character, common sequences).
 * No forced periodic rotation and no "one symbol + one digit" rules.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const WEAK_PATTERNS = [
  /^(.)\1+$/u, // "aaaaaaaaaaaa"
  /^(0123456789|1234567890|abcdefghijkl|qwertyuiop)/i,
  /^(password|contraseña|letmein|welcome)\d*$/i,
];

export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export function passwordPolicyViolations(
  password: string,
  context: { email?: string } = {},
): string[] {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  const violations: string[] = [];

  if (length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    );
  }
  if (length > PASSWORD_MAX_LENGTH) {
    violations.push(
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`,
    );
  }
  if (context.email) {
    const email = context.email.trim().toLowerCase();
    const localPart = email.split('@')[0] ?? '';
    const lowered = normalized.toLowerCase();
    if (lowered === email || (localPart.length >= 4 && lowered === localPart)) {
      violations.push('Password must not be your email address');
    }
  }
  if (WEAK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    violations.push('Password is too easy to guess');
  }
  return violations;
}
