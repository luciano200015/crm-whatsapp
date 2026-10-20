import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  AuthorizationService,
  WorkspaceAccess,
} from '../application/authorization.service';
import type { PermissionKey } from '../domain/permission-catalog';
import { WorkspaceAccessGuard } from './workspace-access.guard';

const WORKSPACE = '0199f0aa-0000-7000-8000-000000000001';

function setup(access: WorkspaceAccess | null, required: PermissionKey[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const authorization = {
    resolveAccess: jest.fn().mockResolvedValue(access),
  } as unknown as AuthorizationService;
  const guard = new WorkspaceAccessGuard(reflector, authorization);

  const request: Record<string, unknown> = {
    params: { workspaceId: WORKSPACE },
    auth: { userId: 'user-1', sessionId: 's' },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard, request, context, authorization };
}

const access = (permissions: PermissionKey[]): WorkspaceAccess => ({
  workspaceId: WORKSPACE,
  membershipId: 'm1',
  roles: ['ADMIN'],
  permissions: new Set(permissions),
});

describe('WorkspaceAccessGuard', () => {
  it('lets a member with every required permission through', async () => {
    const { guard, context, request } = setup(
      access(['billing.read', 'billing.manage']),
      ['billing.manage'],
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.workspaceAccess).toMatchObject({ workspaceId: WORKSPACE });
  });

  it('answers 403 to a member missing a permission', async () => {
    const { guard, context } = setup(access(['billing.read']), [
      'billing.manage',
    ]);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 404 to a non-member, hiding whether the workspace exists', async () => {
    const { guard, context } = setup(null, []);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 404 for a malformed workspace id without querying', async () => {
    const { guard, context, request, authorization } = setup(
      access(['billing.read']),
      [],
    );
    request.params = { workspaceId: "1' OR '1'='1" };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(authorization.resolveAccess).not.toHaveBeenCalled();
  });
});
