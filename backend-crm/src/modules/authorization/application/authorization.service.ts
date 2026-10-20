import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import {
  isPermissionKey,
  type PermissionKey,
} from '../domain/permission-catalog';

export interface WorkspaceAccess {
  workspaceId: string;
  membershipId: string;
  roles: string[];
  permissions: ReadonlySet<PermissionKey>;
}

/**
 * Resolves what a user may do in a workspace, from the database on every
 * call: roles or permissions inside a JWT could be stale after a revocation.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Null when the user has no ACTIVE membership in an ACTIVE/SUSPENDED workspace. */
  async resolveAccess(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceAccess | null> {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        id: true,
        status: true,
        workspace: { select: { status: true } },
        roles: {
          select: {
            role: {
              select: {
                key: true,
                workspaceId: true,
                permissions: {
                  select: { permission: { select: { key: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.workspace.status === 'ARCHIVED'
    ) {
      return null;
    }

    const permissions = new Set<PermissionKey>();
    const roles: string[] = [];
    for (const { role } of membership.roles) {
      // A custom role only counts inside the workspace it belongs to.
      if (role.workspaceId !== null && role.workspaceId !== workspaceId)
        continue;
      roles.push(role.key);
      for (const { permission } of role.permissions) {
        if (isPermissionKey(permission.key)) permissions.add(permission.key);
      }
    }
    return { workspaceId, membershipId: membership.id, roles, permissions };
  }
}
