import {
  normalizePassword,
  PASSWORD_MAX_LENGTH,
  passwordPolicyViolations,
} from './password-policy';

describe('password policy', () => {
  it('accepts a long passphrase without composition rules', () => {
    expect(passwordPolicyViolations('correct horse battery staple')).toEqual(
      [],
    );
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(passwordPolicyViolations('Sh0rt!pass')).toEqual([
      'Password must be at least 12 characters long',
    ]);
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // 11 emoji = 22 UTF-16 units but only 11 characters.
    expect(passwordPolicyViolations('🔒'.repeat(11))).toContain(
      'Password must be at least 12 characters long',
    );
  });

  it('rejects passwords longer than the maximum', () => {
    expect(
      passwordPolicyViolations('a1'.repeat(PASSWORD_MAX_LENGTH)),
    ).toContain(
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`,
    );
  });

  it('rejects the email or its local part', () => {
    expect(
      passwordPolicyViolations('ana.lopez@example.com', {
        email: 'Ana.Lopez@example.com',
      }),
    ).toContain('Password must not be your email address');
    expect(
      passwordPolicyViolations('verylongname', {
        email: 'verylongname@example.com',
      }),
    ).toContain('Password must not be your email address');
  });

  it.each(['aaaaaaaaaaaaaa', '123456789012', 'password12345', 'qwertyuiop123'])(
    'rejects the trivially weak password %p',
    (weak) => {
      expect(passwordPolicyViolations(weak)).toContain(
        'Password is too easy to guess',
      );
    },
  );

  it('normalizes compatibility characters with NFKC', () => {
    // Fullwidth "Ａ" and "A" must hash to the same value.
    expect(normalizePassword('Ａbc')).toBe('Abc');
  });
});
