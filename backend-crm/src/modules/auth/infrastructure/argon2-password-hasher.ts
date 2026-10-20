import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PasswordHasher } from '../application/ports';
import { normalizePassword } from '../domain/password-policy';

/**
 * Argon2id with the library defaults made explicit (64 MiB, t=3, p=4),
 * above the OWASP minimum (19 MiB, t=2, p=1). Raising them later is safe:
 * needsRehash() upgrades hashes on the next successful login.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(normalizePassword(password), ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, normalizePassword(password));
    } catch {
      // A malformed stored hash must never authenticate anyone.
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(16).toString('hex'));
    await this.verify(await this.dummyHash, password);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
