import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface GeneratedToken {
  /** Sent to the client exactly once; never persisted or logged. */
  token: string;
  /** What gets stored: HMAC-SHA256(secret, token) as 64 hex chars. */
  hash: string;
}

/**
 * Opaque tokens (refresh, password reset, email verification, invitations).
 * 256 random bits make brute force infeasible, so a keyed fast hash is enough;
 * the server secret means a database leak alone cannot validate tokens.
 */
@Injectable()
export class TokenHasher {
  private readonly secret: string;

  constructor(config: AppConfigService) {
    this.secret = config.get('TOKEN_HASH_SECRET');
  }

  generate(): GeneratedToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHmac('sha256', this.secret)
      .update(token, 'utf8')
      .digest('hex');
  }
}
