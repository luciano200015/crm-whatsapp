import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthContext, AuthService } from '../application/auth.service';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC } from './auth.decorators';
import { JwtAuthGuard } from './jwt-auth.guard';

function setup(
  auth: AuthContext | null,
  metadata: Record<string, boolean> = {},
) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const service = {
    authenticate: jest.fn().mockResolvedValue(auth),
  } as unknown as AuthService;
  const guard = new JwtAuthGuard(reflector, service);
  const request: Record<string, unknown> = {
    headers: { authorization: 'Bearer token' },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard, request, context };
}

const auth = (mustChangePassword: boolean): AuthContext => ({
  userId: 'user-1',
  sessionId: 'session-1',
  mustChangePassword,
});

describe('JwtAuthGuard', () => {
  it('lets public routes through without a token', async () => {
    const { guard, context } = setup(null, { [IS_PUBLIC]: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('requires a valid session', async () => {
    const { guard, context } = setup(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the auth context', async () => {
    const { guard, context, request } = setup(auth(false));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual(auth(false));
  });

  it('blocks users with a temporary password', async () => {
    const { guard, context } = setup(auth(true));
    const result = guard.canActivate(context);
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await result.catch((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    });
  });

  it('allows the routes needed to change the temporary password', async () => {
    const { guard, context } = setup(auth(true), {
      [ALLOW_PENDING_PASSWORD_CHANGE]: true,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
