import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE, CSRF_HEADER } from './auth-cookies';

/**
 * Double-submit check for endpoints authenticated by the refresh cookie.
 * A cross-site attacker can make the browser send cookies but cannot read
 * the CSRF cookie to copy it into the header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const cookie = cookies?.[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];

    if (
      typeof cookie !== 'string' ||
      typeof header !== 'string' ||
      cookie.length === 0 ||
      !safeEqual(cookie, header)
    ) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
