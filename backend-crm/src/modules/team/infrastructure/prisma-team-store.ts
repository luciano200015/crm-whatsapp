import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  isPermissionKey,
  type PermissionKey,
} from '../../authorization/domain/permission-catalog';
import {
  type AddMemberResult,
  type MemberChangeResult,
  type MemberFilter,
  type MemberRecord,
  type MembershipStatus,
  type NewMember,
  type RoleRecord,
  type RoleWrite,
  TeamStore,
  type UserStatus,
} from '../application/ports';
import { OWNER_ROLE_KEY } from '../domain/team-rules';

type Tx = Prisma.TransactionClient;

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permission: { select: { key: true } } } },
} as const satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

const MEMBER_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  status: true,
  joinedAt: true,
  deactivatedAt: true,
  user: {
    select: {
      email: true,
      displayName: true,
      status: true,
      avatarUrl: true,
      lastLoginAt: true,
      credential: { select: { mustChangePassword: true } },
    },
  },
  roles: {
    orderBy: { assignedAt: 'asc' },
    select: { role: { select: ROLE_SELECT } },
  },
} as const satisfies Prisma.WorkspaceMembershipSelect;

type MemberRow = Prisma.WorkspaceMembershipGetPayload<{
  select: typeof MEMBER_SELECT;
}>;

/** Thrown inside a transaction to roll it back when no active owner would remain. */
class LastOwnerRollback extends Error {}

/** Roles visible in a workspace: the system ones and its own. */
const visibleRoles = (workspaceId: string): Prisma.RoleWhereInput => ({
  OR: [{ workspaceId: null }, { workspaceId }],
});

function permissionsOf(row: RoleRow): PermissionKey[] {
  return row.permissions
    .map(({ permission }) => permission.key)
    .filter(isPermissionKey)
    .sort();
}

function toRole(row: RoleRow, memberCount: number): RoleRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    workspaceId: row.workspaceId,
    permissions: permissionsOf(row),
    memberCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMember(row: MemberRow): MemberRecord {
  // A custom role only counts inside its own workspace (as in AuthorizationService).
  const roles = row.roles
    .map(({ role }) => role)
    .filter(
      (role) =>
        role.workspaceId === null || role.workspaceId === row.workspaceId,
    );
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    status: row.status,
    joinedAt: row.joinedAt,
    deactivatedAt: row.deactivatedAt,
    user: {
      email: row.user.email,
      displayName: row.user.displayName,
      status: row.user.status,
      avatarUrl: row.user.avatarUrl,
      lastLoginAt: row.user.lastLoginAt,
      pendingFirstAccess: row.user.credential?.mustChangePassword ?? false,
    },
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      system: role.workspaceId === null,
    })),
    permissions: [...new Set(roles.flatMap(permissionsOf))].sort(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PrismaTeamStore extends TeamStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // ─────────────────────────── Roles ───────────────────────────

  async listRoles(workspaceId: string): Promise<RoleRecord[]> {
    const rows = await this.prisma.role.findMany({
      where: visibleRoles(workspaceId),
      // System roles first, in catalog order (OWNER, ADMIN, AGENT), then custom ones by name.
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
    const counts = await this.memberCounts(
      workspaceId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toRole(row, counts.get(row.id) ?? 0));
  }

  async findRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RoleRecord | null> {
    const row = await this.prisma.role.findFirst({
      where: { id: roleId, ...visibleRoles(workspaceId) },
      select: ROLE_SELECT,
    });
    if (!row) return null;
    const counts = await this.memberCounts(workspaceId, [row.id]);
    return toRole(row, counts.get(row.id) ?? 0);
  }

  async createRole(
    workspaceId: string,
    data: RoleWrite,
  ): Promise<RoleRecord | 'key_taken'> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const permissionIds = await this.permissionIds(tx, data.permissions);
        return tx.role.create({
          data: {
            workspaceId,
            isSystem: false,
            key: data.key,
            name: data.name,
            description: data.description,
            permissions: {
              create: permissionIds.map((permissionId) => ({ permissionId })),
            },
          },
          select: ROLE_SELECT,
        });
      });
      return toRole(row, 0);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return 'key_taken';
      throw error;
    }
  }

  async updateRole(
    workspaceId: string,
    roleId: string,
    data: Partial<RoleWrite>,
  ): Promise<RoleRecord | 'key_taken'> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (data.permissions) {
          const permissionIds = await this.permissionIds(tx, data.permissions);
          await tx.rolePermission.deleteMany({ where: { roleId } });
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId,
              permissionId,
            })),
          });
        }
        // workspaceId in the filter: a custom role of another workspace is never touched.
        await tx.role.update({
          where: { id: roleId, workspaceId },
          data: {
            key: data.key,
            name: data.name,
            description: data.description,
          },
        });
        return tx.role.findUniqueOrThrow({
          where: { id: roleId },
          select: ROLE_SELECT,
        });
      });
      const counts = await this.memberCounts(workspaceId, [roleId]);
      return toRole(row, counts.get(roleId) ?? 0);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return 'key_taken';
      throw error;
    }
  }

  deleteRole(
    workspaceId: string,
    roleId: string,
  ): Promise<{ kind: 'deleted' } | { kind: 'in_use'; members: number }> {
    return this.prisma.$transaction(async (tx) => {
      const [members, invitations] = await Promise.all([
        tx.membershipRole.count({ where: { roleId } }),
        tx.workspaceInvitation.count({ where: { roleId } }),
      ]);
      if (members + invitations > 0) {
        return { kind: 'in_use', members } as const;
      }
      await tx.role.delete({ where: { id: roleId, workspaceId } });
      return { kind: 'deleted' } as const;
    });
  }

  private async memberCounts(
    workspaceId: string,
    roleIds: string[],
  ): Promise<Map<string, number>> {
    const groups = await this.prisma.membershipRole.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roleIds }, membership: { workspaceId } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.roleId, group._count._all]));
  }

  private async permissionIds(
    tx: Tx,
    keys: PermissionKey[],
  ): Promise<string[]> {
    const rows = await tx.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    if (rows.length !== new Set(keys).size) {
      throw new Error('Permission catalog out of sync: run the seed');
    }
    return rows.map((row) => row.id);
  }

  // ─────────────────────────── Members ───────────────────────────

  async listMembers(
    workspaceId: string,
    filter: MemberFilter,
  ): Promise<{ items: MemberRecord[]; total: number }> {
    const search = filter.search?.trim();
    const where: Prisma.WorkspaceMembershipWhereInput = {
      workspaceId,
      ...(filter.status && { status: filter.status }),
      ...(filter.roleId && { roles: { some: { roleId: filter.roleId } } }),
      ...(search && {
        user: {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workspaceMembership.findMany({
        where,
        // Active first, then by name.
        orderBy: [{ status: 'asc' }, { user: { displayName: 'asc' } }],
        take: filter.limit,
        skip: filter.offset,
        select: MEMBER_SELECT,
      }),
      this.prisma.workspaceMembership.count({ where }),
    ]);
    return { items: rows.map(toMember), total };
  }

  async findMember(
    workspaceId: string,
    memberId: string,
  ): Promise<MemberRecord | null> {
    const row = await this.prisma.workspaceMembership.findFirst({
      where: { id: memberId, workspaceId },
      select: MEMBER_SELECT,
    });
    return row ? toMember(row) : null;
  }

  countActiveMembers(workspaceId: string): Promise<number> {
    return this.prisma.workspaceMembership.count({
      where: { workspaceId, status: 'ACTIVE' },
    });
  }

  findUserByEmail(
    email: string,
  ): Promise<{ id: string; displayName: string; status: UserStatus } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, displayName: true, status: true },
    });
  }

  async emailNames(
    workspaceId: string,
    actorUserId: string,
  ): Promise<{ workspaceName: string; actorName: string }> {
    const [workspace, actor] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { name: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: { displayName: true },
      }),
    ]);
    return { workspaceName: workspace.name, actorName: actor.displayName };
  }

  async addMember(input: NewMember): Promise<AddMemberResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, input.workspaceId);

        if (input.user.kind === 'existing') {
          const existing = await tx.workspaceMembership.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: input.workspaceId,
                userId: input.user.userId,
              },
            },
            select: { status: true },
          });
          if (existing) {
            return { kind: 'already_member', status: existing.status } as const;
          }
        }

        const activeMembers = await tx.workspaceMembership.count({
          where: { workspaceId: input.workspaceId, status: 'ACTIVE' },
        });
        if (
          input.maxActiveMembers !== null &&
          activeMembers >= input.maxActiveMembers
        ) {
          return { kind: 'limit_reached', activeMembers } as const;
        }

        const userId =
          input.user.kind === 'existing'
            ? input.user.userId
            : (
                await tx.user.create({
                  data: {
                    email: input.user.email,
                    displayName: input.user.displayName,
                    // Usable right away; the email is verified when the
                    // temporary password is replaced (see AuthStore.changePassword).
                    status: 'ACTIVE',
                    credential: {
                      create: {
                        passwordHash: input.user.passwordHash,
                        mustChangePassword: true,
                      },
                    },
                  },
                  select: { id: true },
                })
              ).id;

        const row = await tx.workspaceMembership.create({
          data: {
            workspaceId: input.workspaceId,
            userId,
            status: 'ACTIVE',
            invitedById: input.invitedById,
            roles: {
              create: { roleId: input.roleId, assignedById: input.invitedById },
            },
          },
          select: MEMBER_SELECT,
        });
        return { kind: 'added', member: toMember(row) } as const;
      });
    } catch (error: unknown) {
      // users.email: someone signed up with this email in the meantime.
      if (isUniqueViolation(error) && input.user.kind === 'new') {
        return { kind: 'email_taken' };
      }
      throw error;
    }
  }

  replaceRole(
    workspaceId: string,
    memberId: string,
    roleId: string,
    assignedById: string,
  ): Promise<MemberChangeResult> {
    return this.changeMember(workspaceId, memberId, async (tx) => {
      await tx.membershipRole.deleteMany({ where: { membershipId: memberId } });
      await tx.membershipRole.create({
        data: { membershipId: memberId, roleId, assignedById },
      });
      return null;
    });
  }

  setStatus(
    workspaceId: string,
    memberId: string,
    status: MembershipStatus,
    now: Date,
    maxActiveMembers: number | null,
  ): Promise<MemberChangeResult> {
    return this.changeMember(workspaceId, memberId, async (tx) => {
      if (status === 'ACTIVE' && maxActiveMembers !== null) {
        const activeMembers = await tx.workspaceMembership.count({
          where: { workspaceId, status: 'ACTIVE' },
        });
        if (activeMembers >= maxActiveMembers) {
          return { kind: 'limit_reached', activeMembers } as const;
        }
      }
      await tx.workspaceMembership.update({
        where: { id: memberId, workspaceId },
        data: {
          status,
          deactivatedAt: status === 'DEACTIVATED' ? now : null,
        },
      });
      return null;
    });
  }

  async resetTemporaryPassword(
    userId: string,
    passwordHash: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.userCredential.updateMany({
      where: { userId, mustChangePassword: true },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    return count === 1;
  }

  /**
   * Runs a membership change under the workspace lock and rolls it back if
   * the workspace would be left without an active owner.
   */
  private async changeMember(
    workspaceId: string,
    memberId: string,
    change: (
      tx: Tx,
    ) => Promise<{ kind: 'limit_reached'; activeMembers: number } | null>,
  ): Promise<MemberChangeResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, workspaceId);
        const refused = await change(tx);
        if (refused) return refused;

        const owners = await tx.workspaceMembership.count({
          where: {
            workspaceId,
            status: 'ACTIVE',
            roles: {
              some: { role: { key: OWNER_ROLE_KEY, workspaceId: null } },
            },
          },
        });
        if (owners === 0) throw new LastOwnerRollback();

        const row = await tx.workspaceMembership.findUniqueOrThrow({
          where: { id: memberId },
          select: MEMBER_SELECT,
        });
        return { kind: 'ok', member: toMember(row) } as const;
      });
    } catch (error: unknown) {
      if (error instanceof LastOwnerRollback) return { kind: 'last_owner' };
      throw error;
    }
  }

  /** Serializes membership changes of one workspace (plan limits, last owner). */
  private async lockWorkspace(tx: Tx, workspaceId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "workspaces" WHERE "id" = ${workspaceId}::uuid FOR UPDATE`;
  }
}
