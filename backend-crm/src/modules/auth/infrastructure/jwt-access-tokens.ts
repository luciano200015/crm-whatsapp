import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import { AccessTokenClaims, AccessTokens } from '../application/ports';

export const JWT_ALGORITHM = 'ES256';

interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/**
 * Short-lived ES256 access tokens. Verification pins the algorithm
 * (blocks "none" and HS/RS confusion) and checks issuer and audience.
 * A valid JWT only proves identity: the guard still checks the session.
 */
@Injectable()
export class JwtAccessTokens extends AccessTokens {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  async issue(
    claims: AccessTokenClaims,
  ): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const payload: AccessTokenPayload = {
      sub: claims.userId,
      sid: claims.sessionId,
    };
    const token = await this.jwt.signAsync(payload, {
      algorithm: JWT_ALGORITHM,
      privateKey: this.config.get('JWT_PRIVATE_KEY'),
      issuer: this.config.get('JWT_ISSUER'),
      audience: this.config.get('JWT_AUDIENCE'),
      expiresIn,
      jwtid: randomUUID(),
    });
    return { token, expiresIn };
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          algorithms: [JWT_ALGORITHM],
          publicKey: this.config.get('JWT_PUBLIC_KEY'),
          issuer: this.config.get('JWT_ISSUER'),
          audience: this.config.get('JWT_AUDIENCE'),
        },
      );
      const { sub, sid } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string') return null;
      return { userId: sub, sessionId: sid };
    } catch {
      // Expired, malformed, forged or wrong-algorithm tokens are all just "invalid".
      return null;
    }
  }
}
