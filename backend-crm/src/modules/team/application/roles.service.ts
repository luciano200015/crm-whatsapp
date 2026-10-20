import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  permissionGroup,
  type PermissionGroup,
  type PermissionKey,
} from '../../authorization/domain/permission-catalog';
import { customRoleKey } from '../domain/team-rules';
import { RoleRecord, TeamStore, WorkspaceEntitlements } from './ports';
import {
  assertCustomRolesIncluded,
  assertHolds,
  requirePlan,
  type TeamActor,
} from './team-access';
import { TeamErrors } from './team-errors';

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** System role (workspaceId null): read-only. */
  system: boolean;
  permissions: PermissionKey[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionView {
  key: PermissionKey;
  group: PermissionGroup;
  description: string;
}

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
}

/** Custom roles per workspace, built from the permission catalog. */
@Injectable()
export class RolesService {
  constructor(
    private readonly store: TeamStore,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly audit: AuditService,
  ) {}

  permissions(): PermissionView[] {
    return ALL_PERMISSION_KEYS.map((key) => ({
      key,
      group: permissionGroup(key),
      description: PERMISSIONS[key],
    }));
  }

  async list(workspaceId: string): Promise<RoleView[]> {
    const roles = await this.store.listRoles(workspaceId);
    return roles.map(toView);
  }

  async get(workspaceId: string, roleId: string): Promise<RoleView> {
    return toView(await this.requireRole(workspaceId, roleId));
  }

  async create(actor: TeamActor, input: RoleInput): Promise<RoleView> {
    const { workspaceId } = actor.access;
    assertCustomRolesIncluded(
      await requirePlan(this.entitlements, workspaceId),
    );
    assertHolds(actor, input.permissions);

    const name = input.name.trim();
    const created = await this.store.createRole(workspaceId, {
      key: customRoleKey(name),
      name,
      description: input.description?.trim() || null,
      permissions: unique(input.permissions),
    });
    if (created === 'key_taken') throw TeamErrors.roleNameTaken();

    await this.audit.record({
      action: 'team.role.created',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'role',
      targetId: created.id,
      context: actor.context,
      metadata: { name: created.name, permissions: created.permissions },
    });
    return toView(created);
  }

  async update(
    actor: TeamActor,
    roleId: string,
    input: Partial<RoleInput>,
  ): Promise<RoleView> {
    const { workspaceId } = actor.access;
    const role = await this.requireCustomRole(workspaceId, roleId);
    assertCustomRolesIncluded(
      await requirePlan(this.entitlements, workspaceId),
    );
    // Editing a role changes what its members can do: the actor must hold
    // both what it grants today and what it will grant.
    assertHolds(actor, role.permissions);
    if (input.permissions) assertHolds(actor, input.permissions);

    const name = input.name?.trim();
    const updated = await this.store.updateRole(workspaceId, roleId, {
      ...(name !== undefined && { name, key: customRoleKey(name) }),
      ...(input.description !== undefined && {
        description: input.description?.trim() || null,
      }),
      ...(input.permissions && { permissions: unique(input.permissions) }),
    });
    if (updated === 'key_taken') throw TeamErrors.roleNameTaken();

    await this.audit.record({
      action: 'team.role.updated',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'role',
      targetId: roleId,
      context: actor.context,
      metadata: {
        fields: Object.keys(input).filter(
          (key) => input[key as keyof RoleInput] !== undefined,
        ),
        permissions: updated.permissions,
      },
    });
    return toView(updated);
  }

  /** Allowed even when the plan no longer includes custom roles (clean-up). */
  async remove(actor: TeamActor, roleId: string): Promise<void> {
    const { workspaceId } = actor.access;
    const role = await this.requireCustomRole(workspaceId, roleId);
    assertHolds(actor, role.permissions);

    const result = await this.store.deleteRole(workspaceId, roleId);
    if (result.kind === 'in_use') throw TeamErrors.roleInUse(result.members);

    await this.audit.record({
      action: 'team.role.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'role',
      targetId: roleId,
      context: actor.context,
      metadata: { name: role.name },
    });
  }

  private async requireRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RoleRecord> {
    const role = await this.store.findRole(workspaceId, roleId);
    if (!role) throw TeamErrors.roleNotFound();
    return role;
  }

  private async requireCustomRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RoleRecord> {
    const role = await this.requireRole(workspaceId, roleId);
    if (role.workspaceId === null) throw TeamErrors.systemRoleReadOnly();
    return role;
  }
}

export function toView(role: RoleRecord): RoleView {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    system: role.workspaceId === null,
    permissions: [...role.permissions].sort(),
    memberCount: role.memberCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function unique(permissions: PermissionKey[]): PermissionKey[] {
  return [...new Set(permissions)].sort();
}
