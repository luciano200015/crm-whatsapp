import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../application/auth.service';
import {
  ALLOW_PENDING_PASSWORD_CHANGE,
  AuthenticatedRequest,
  IS_PUBLIC,
} from './auth.decorators';

/**
 * Global guard: every route requires a valid Bearer access token unless it
 * is marked @Public(). The token must be a valid ES256 JWT *and* belong to
 * an active session of an active user. Users with a temporary password can
 * only reach routes marked @AllowPendingPasswordChange().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    const auth = token ? await this.auth.authenticate(token) : null;
    if (!auth) throw new UnauthorizedException('Authentication required');

    if (
      auth.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_PASSWORD_CHANGE,
        [context.getHandler(), context.getClass()],
      )
    ) {
      throw new ForbiddenException({
        message: 'Change your temporary password to continue',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    request.auth = auth;
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return null;
  }
  return token;
}
