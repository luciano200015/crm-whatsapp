import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  SYSTEM_ROLES,
  type PermissionKey,
} from '../../authorization/domain/permission-catalog';
import { PLANS, type PlanCode } from '../../billing/domain/plan-catalog';
import { OWNER_ROLE_KEY } from '../domain/team-rules';
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
  WorkspaceEntitlements,
  type WorkspaceEntitlementsView,
} from './ports';
import type { TeamActor } from './team-access';

/** Test doubles shared by the team service specs. */

export const WS = 'ws-1';
export const OTHER_WS = 'ws-2';
const T0 = new Date('2026-10-20T12:00:00Z');

const systemRole = (key: keyof typeof SYSTEM_ROLES): RoleRecord => ({
  id: `role-${key}`,
  key,
  name: SYSTEM_ROLES[key].name,
  description: SYSTEM_ROLES[key].description,
  workspaceId: null,
  permissions: [...SYSTEM_ROLES[key].permissions],
  memberCount: 0,
  createdAt: T0,
  updatedAt: T0,
});

interface FakeMember {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string;
  status: MembershipStatus;
  roleIds: string[];
  pendingFirstAccess: boolean;
}

/** In-memory TeamStore with the same rules as PrismaTeamStore. */
export class FakeTeamStore extends TeamStore {
  roles: RoleRecord[] = [
    systemRole('OWNER'),
    systemRole('ADMIN'),
    systemRole('AGENT'),
  ];
  members: FakeMember[] = [];
  users = new Map<string, { id: string; displayName: string }>();
  passwordResets: string[] = [];
  private seq = 0;

  addFake(
    email: string,
    roleKey: string,
    options: {
      status?: MembershipStatus;
      workspaceId?: string;
      pendingFirstAccess?: boolean;
    } = {},
  ): FakeMember {
    const userId = this.users.get(email)?.id ?? `user-${++this.seq}`;
    this.users.set(email, {
      id: userId,
      displayName: email.split('@')[0] ?? email,
    });
    const member: FakeMember = {
      id: `member-${++this.seq}`,
      workspaceId: options.workspaceId ?? WS,
      userId,
      email,
      displayName: email.split('@')[0] ?? email,
      status: options.status ?? 'ACTIVE',
      roleIds: [this.roleByKey(roleKey).id],
      pendingFirstAccess: options.pendingFirstAccess ?? false,
    };
    this.members.push(member);
    return member;
  }

  addCustomRole(
    key: string,
    permissions: PermissionKey[],
    workspaceId = WS,
  ): RoleRecord {
    const role: RoleRecord = {
      id: `role-${workspaceId}-${key}`,
      key,
      name: key,
      description: null,
      workspaceId,
      permissions,
      memberCount: 0,
      createdAt: T0,
      updatedAt: T0,
    };
    this.roles.push(role);
    return role;
  }

  roleByKey(key: string): RoleRecord {
    const role = this.roles.find((r) => r.key === key);
    if (!role) throw new Error(`no role ${key}`);
    return role;
  }

  private visible(workspaceId: string) {
    return this.roles.filter(
      (r) => r.workspaceId === null || r.workspaceId === workspaceId,
    );
  }

  private withCount(workspaceId: string, role: RoleRecord): RoleRecord {
    return {
      ...role,
      memberCount: this.members.filter(
        (m) => m.workspaceId === workspaceId && m.roleIds.includes(role.id),
      ).length,
    };
  }

  private record(member: FakeMember): MemberRecord {
    const roles = member.roleIds.map((id) =>
      this.roles.find((r) => r.id === id)!,
    );
    return {
      id: member.id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      status: member.status,
      joinedAt: T0,
      deactivatedAt: member.status === 'DEACTIVATED' ? T0 : null,
      user: {
        email: member.email,
        displayName: member.displayName,
        status: 'ACTIVE',
        avatarUrl: null,
        lastLoginAt: null,
        pendingFirstAccess: member.pendingFirstAccess,
      },
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        system: r.workspaceId === null,
      })),
      permissions: [...new Set(roles.flatMap((r) => r.permissions))].sort(),
    };
  }

  private active(workspaceId: string) {
    return this.members.filter(
      (m) => m.workspaceId === workspaceId && m.status === 'ACTIVE',
    ).length;
  }

  private owners(workspaceId: string) {
    const owner = this.roleByKey(OWNER_ROLE_KEY).id;
    return this.members.filter(
      (m) =>
        m.workspaceId === workspaceId &&
        m.status === 'ACTIVE' &&
        m.roleIds.includes(owner),
    ).length;
  }

  listRoles(workspaceId: string) {
    return Promise.resolve(
      this.visible(workspaceId).map((r) => this.withCount(workspaceId, r)),
    );
  }
  findRole(workspaceId: string, roleId: string) {
    const role = this.visible(workspaceId).find((r) => r.id === roleId);
    return Promise.resolve(role ? this.withCount(workspaceId, role) : null);
  }
  createRole(workspaceId: string, data: RoleWrite) {
    if (
      this.roles.some(
        (r) => r.workspaceId === workspaceId && r.key === data.key,
      )
    ) {
      return Promise.resolve('key_taken' as const);
    }
    return Promise.resolve(
      this.addCustomRole(data.key, data.permissions, workspaceId),
    ).then((role) =>
      Object.assign(role, { name: data.name, description: data.description }),
    );
  }
  updateRole(workspaceId: string, roleId: string, data: Partial<RoleWrite>) {
    if (
      data.key &&
      this.roles.some(
        (r) =>
          r.workspaceId === workspaceId &&
          r.key === data.key &&
          r.id !== roleId,
      )
    ) {
      return Promise.resolve('key_taken' as const);
    }
    const role = this.roles.find((r) => r.id === roleId)!;
    Object.assign(
      role,
      Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ),
    );
    return Promise.resolve(this.withCount(workspaceId, role));
  }
  deleteRole(workspaceId: string, roleId: string) {
    const members = this.members.filter((m) =>
      m.roleIds.includes(roleId),
    ).length;
    if (members > 0)
      return Promise.resolve({ kind: 'in_use' as const, members });
    this.roles = this.roles.filter((r) => r.id !== roleId);
    return Promise.resolve({ kind: 'deleted' as const });
  }

  listMembers(workspaceId: string, filter: MemberFilter) {
    const items = this.members
      .filter((m) => m.workspaceId === workspaceId)
      .filter((m) => !filter.status || m.status === filter.status)
      .map((m) => this.record(m));
    return Promise.resolve({ items, total: items.length });
  }
  findMember(workspaceId: string, memberId: string) {
    const member = this.members.find(
      (m) => m.id === memberId && m.workspaceId === workspaceId,
    );
    return Promise.resolve(member ? this.record(member) : null);
  }
  countActiveMembers(workspaceId: string) {
    return Promise.resolve(this.active(workspaceId));
  }
  findUserByEmail(email: string) {
    const user = this.users.get(email);
    return Promise.resolve(
      user ? { ...user, status: 'ACTIVE' as const } : null,
    );
  }
  emailNames() {
    return Promise.resolve({ workspaceName: 'Acme', actorName: 'Owner' });
  }

  addMember(input: NewMember): Promise<AddMemberResult> {
    const userId =
      input.user.kind === 'existing' ? input.user.userId : undefined;
    const existing = this.members.find(
      (m) => m.workspaceId === input.workspaceId && m.userId === userId,
    );
    if (existing) {
      return Promise.resolve({
        kind: 'already_member',
        status: existing.status,
      });
    }
    const activeMembers = this.active(input.workspaceId);
    if (
      input.maxActiveMembers !== null &&
      activeMembers >= input.maxActiveMembers
    ) {
      return Promise.resolve({ kind: 'limit_reached', activeMembers });
    }
    const email =
      input.user.kind === 'new'
        ? input.user.email
        : [...this.users.entries()].find(([, u]) => u.id === userId)![0];
    const role = this.roles.find((r) => r.id === input.roleId)!;
    const member = this.addFake(email, role.key, {
      workspaceId: input.workspaceId,
      pendingFirstAccess: input.user.kind === 'new',
    });
    return Promise.resolve({ kind: 'added', member: this.record(member) });
  }

  replaceRole(
    workspaceId: string,
    memberId: string,
    roleId: string,
  ): Promise<MemberChangeResult> {
    return this.change(workspaceId, memberId, (m) => {
      m.roleIds = [roleId];
    });
  }

  setStatus(
    workspaceId: string,
    memberId: string,
    status: MembershipStatus,
    _now: Date,
    maxActiveMembers: number | null,
  ): Promise<MemberChangeResult> {
    if (status === 'ACTIVE' && maxActiveMembers !== null) {
      const activeMembers = this.active(workspaceId);
      if (activeMembers >= maxActiveMembers) {
        return Promise.resolve({ kind: 'limit_reached', activeMembers });
      }
    }
    return this.change(workspaceId, memberId, (m) => {
      m.status = status;
    });
  }

  resetTemporaryPassword(userId: string) {
    const member = this.members.find((m) => m.userId === userId);
    if (!member?.pendingFirstAccess) return Promise.resolve(false);
    this.passwordResets.push(userId);
    return Promise.resolve(true);
  }

  private change(
    workspaceId: string,
    memberId: string,
    mutate: (member: FakeMember) => void,
  ): Promise<MemberChangeResult> {
    const member = this.members.find((m) => m.id === memberId)!;
    const before = { ...member, roleIds: [...member.roleIds] };
    mutate(member);
    if (this.owners(workspaceId) === 0) {
      Object.assign(member, before);
      return Promise.resolve({ kind: 'last_owner' });
    }
    return Promise.resolve({ kind: 'ok', member: this.record(member) });
  }
}

export class FakeEntitlements extends WorkspaceEntitlements {
  view: WorkspaceEntitlementsView | null;

  constructor(plan: PlanCode = 'business', hasFullAccess = true) {
    super();
    this.view = {
      planName: PLANS[plan].name,
      hasFullAccess,
      features: PLANS[plan].features,
    };
  }

  entitlements() {
    return Promise.resolve(this.view);
  }
}

/** The actor as WorkspaceAccessGuard would resolve it. */
export function actorFor(
  member: { id: string; userId: string; workspaceId?: string },
  permissions: readonly PermissionKey[],
): TeamActor {
  const access: WorkspaceAccess = {
    workspaceId: member.workspaceId ?? WS,
    membershipId: member.id,
    roles: [],
    permissions: new Set(permissions),
  };
  return {
    userId: member.userId,
    access,
    context: { ipAddress: null, userAgent: null, requestId: null },
  };
}
