import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = SecretBox.withKey(randomBytes(32));

  it('round-trips a secret and never returns the plaintext', () => {
    const sealed = box.encrypt('EAAG-access-token');
    expect(sealed).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(sealed).not.toContain('EAAG');
    expect(box.decrypt(sealed)).toBe('EAAG-access-token');
  });

  it('uses a fresh IV every time', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('rejects tampered values and other keys', () => {
    const sealed = box.encrypt('secret');
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = `${data?.startsWith('A') ? 'B' : 'A'}${data?.slice(1)}`;
    expect(() => box.decrypt([v, iv, tag, flipped].join(':'))).toThrow();
    expect(() => SecretBox.withKey(randomBytes(32)).decrypt(sealed)).toThrow();
    expect(() => box.decrypt('plain-text')).toThrow(/Unsupported/);
  });
});
