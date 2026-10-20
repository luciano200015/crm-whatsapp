import { randomInt } from 'node:crypto';

/** No look-alike characters (0/O, 1/l/I) so it can be typed from an email. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const LENGTH = 16;

/**
 * One-time password for accounts created by an admin: ~92 bits of entropy
 * from the OS CSPRNG. It is sent by email once, stored only as a hash, and
 * the user must replace it on first sign-in.
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
