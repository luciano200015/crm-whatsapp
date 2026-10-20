import { passwordPolicyViolations } from '../../modules/auth/domain/password-policy';
import { generateTemporaryPassword } from './temporary-password';

describe('generateTemporaryPassword', () => {
  it('meets the password policy and avoids look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
      expect(passwordPolicyViolations(password)).toEqual([]);
    }
  });

  it('does not repeat', () => {
    const passwords = new Set(
      Array.from({ length: 1000 }, () => generateTemporaryPassword()),
    );
    expect(passwords.size).toBe(1000);
  });
});
