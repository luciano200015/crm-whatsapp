import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { WorkspaceAccess } from '../application/authorization.service';
import type { PermissionKey } from '../domain/permission-catalog';

export const REQUIRED_PERMISSIONS = 'authorization:requiredPermissions';

/**
 * Every listed permission is required in the workspace of the
 * `:workspaceId` route parameter. Use together with WorkspaceAccessGuard.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export type WorkspaceRequest = Request & { workspaceAccess?: WorkspaceAccess };

/** The caller's membership, roles and permissions in the current workspace. */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceAccess => {
    const request = ctx.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.workspaceAccess) {
      // Programming error: the route forgot WorkspaceAccessGuard.
      throw new ForbiddenException();
    }
    return request.workspaceAccess;
  },
);
