import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../application/auth.service';

export const IS_PUBLIC = 'auth:isPublic';

/** Opts a route out of the global JwtAuthGuard. Everything else requires a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** The authenticated user and session, as resolved by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthorizedException();
    return request.auth;
  },
);
