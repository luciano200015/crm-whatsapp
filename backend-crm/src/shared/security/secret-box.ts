import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Encrypts third-party credentials at rest (WhatsApp access tokens, App
 * Secrets) with AES-256-GCM and CHANNEL_SECRETS_KEY. The output carries the
 * version, IV and auth tag: "v1:<iv>:<tag>:<ciphertext>" (base64url parts).
 * Rotating the key requires re-encrypting the stored values.
 */
@Injectable()
export class SecretBox {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get('CHANNEL_SECRETS_KEY'), 'base64');
  }

  static withKey(key: Buffer): SecretBox {
    const box = Object.create(SecretBox.prototype) as SecretBox;
    Object.assign(box, { key });
    return box;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join(':');
  }

  /** Throws if the value was tampered with or encrypted with another key. */
  decrypt(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported encrypted value');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
