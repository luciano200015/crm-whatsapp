import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../auth/presentation/auth.decorators';
import { AuthorizationService } from '../application/authorization.service';
import type { PermissionKey } from '../domain/permission-catalog';
import {
  REQUIRED_PERMISSIONS,
  type WorkspaceRequest,
} from './workspace-access.decorators';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards routes under /workspaces/:workspaceId. Runs after the global
 * JwtAuthGuard, so the user is already authenticated.
 * - Not a member (or the workspace does not exist): 404, so workspace ids
 *   cannot be probed.
 * - Member without the required permissions: 403.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & WorkspaceRequest>();
    const workspaceId = request.params.workspaceId;
    const userId = request.auth?.userId;

    if (!userId || typeof workspaceId !== 'string' || !UUID.test(workspaceId)) {
      throw new NotFoundException('Workspace not found');
    }

    const access = await this.authorization.resolveAccess(userId, workspaceId);
    if (!access) throw new NotFoundException('Workspace not found');

    const required =
      this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
        REQUIRED_PERMISSIONS,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (!required.every((permission) => access.permissions.has(permission))) {
      throw new ForbiddenException('You do not have permission to do this');
    }

    request.workspaceAccess = access;
    return true;
  }
}
