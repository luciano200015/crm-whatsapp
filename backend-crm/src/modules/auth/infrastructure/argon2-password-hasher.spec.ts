import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('produces an Argon2id hash that verifies the right password only', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    await expect(
      hasher.verify(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(
      hasher.verify(hash, 'correct horse battery stapl'),
    ).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      hasher.hash('same password here'),
      hasher.hash('same password here'),
    ]);
    expect(a).not.toBe(b);
  });

  it('treats NFKC-equivalent passwords as equal', async () => {
    const hash = await hasher.hash('Ａpassword-with-fullwidth');
    await expect(hasher.verify(hash, 'Apassword-with-fullwidth')).resolves.toBe(
      true,
    );
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    await expect(hasher.verify('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    const hash = await hasher.hash('rehash me please');
    expect(hasher.needsRehash(hash)).toBe(false);

    const weak = hash.replace('m=65536,p=4,t=3', 'm=19456,p=1,t=2');
    expect(hasher.needsRehash(weak)).toBe(true);
  });

  it('runs a dummy verification without throwing', async () => {
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
