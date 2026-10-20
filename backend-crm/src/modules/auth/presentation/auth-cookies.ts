import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';

export const REFRESH_COOKIE = 'crm_rt';
export const CSRF_COOKIE = 'crm_csrf';
export const CSRF_HEADER = 'x-csrf-token';
/** The refresh cookie is only ever sent to /auth/refresh and /auth/logout. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Refresh token: HttpOnly cookie scoped to the auth routes.
 * CSRF token: readable cookie (double-submit) that the client echoes in the
 * X-CSRF-Token header on requests that rely on the refresh cookie.
 */
@Injectable()
export class AuthCookies {
  constructor(private readonly config: AppConfigService) {}

  setSession(response: Response, refreshToken: string, expiresAt: Date): void {
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
    response.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.baseOptions(),
      httpOnly: true,
      path: REFRESH_COOKIE_PATH,
      maxAge,
    });
    response.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
      ...this.baseOptions(),
      httpOnly: false,
      path: '/',
      maxAge,
    });
  }

  clear(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, {
      ...this.baseOptions(),
      httpOnly: true,
      path: REFRESH_COOKIE_PATH,
    });
    response.clearCookie(CSRF_COOKIE, { ...this.baseOptions(), path: '/' });
  }

  private baseOptions(): CookieOptions {
    const domain = this.config.get('COOKIE_DOMAIN');
    return {
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: this.config.get('COOKIE_SAMESITE'),
      ...(domain ? { domain } : {}),
    };
  }
}
