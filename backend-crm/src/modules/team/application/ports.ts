import type {
  MembershipStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import type { PermissionKey } from '../../authorization/domain/permission-catalog';
import type {
  FeatureKey,
  FeatureValue,
} from '../../billing/domain/plan-catalog';

export type { MembershipStatus, UserStatus };

// ─────────────────────────── Plan entitlements ───────────────────────────

export interface WorkspaceEntitlementsView {
  planName: string;
  /** Trial running or paid: creating and reactivating members is allowed. */
  hasFullAccess: boolean;
  /** number|null for limits (null = unlimited), boolean for inclusions. */
  features: Partial<Record<FeatureKey, FeatureValue>>;
}

/**
 * What the workspace's plan allows. Implemented by the billing module; the
 * team module only depends on this interface.
 */
export abstract class WorkspaceEntitlements {
  /** Null when the workspace has no subscription. */
  abstract entitlements(
    workspaceId: string,
  ): Promise<WorkspaceEntitlementsView | null>;
}

// ─────────────────────────── Records ───────────────────────────

export interface RoleRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** null = system role (shared, read-only); set = custom role of that workspace. */
  workspaceId: string | null;
  permissions: PermissionKey[];
  /** Members of the queried workspace (active or not) that hold the role. */
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRecord {
  /** Membership id. */
  id: string;
  workspaceId: string;
  userId: string;
  status: MembershipStatus;
  joinedAt: Date;
  deactivatedAt: Date | null;
  user: {
    email: string;
    displayName: string;
    status: UserStatus;
    avatarUrl: string | null;
    lastLoginAt: Date | null;
    /** Still has the temporary password (never signed in and changed it). */
    pendingFirstAccess: boolean;
  };
  roles: { id: string; key: string; name: string; system: boolean }[];
  /** Union of the permissions of the member's roles. */
  permissions: PermissionKey[];
}

export interface MemberFilter {
  status?: MembershipStatus;
  roleId?: string;
  /** Matches name or email, case-insensitive. */
  search?: string;
  limit: number;
  offset: number;
}

export interface RoleWrite {
  key: string;
  name: string;
  description: string | null;
  permissions: PermissionKey[];
}

export type NewMemberUser =
  | { kind: 'existing'; userId: string }
  | {
      kind: 'new';
      email: string;
      displayName: string;
      /** Hash of the temporary password; the account must change it. */
      passwordHash: string;
    };

export interface NewMember {
  workspaceId: string;
  user: NewMemberUser;
  roleId: string;
  invitedById: string;
  /** Active members allowed by the plan; null = unlimited. */
  maxActiveMembers: number | null;
}

export type AddMemberResult =
  | { kind: 'added'; member: MemberRecord }
  | { kind: 'limit_reached'; activeMembers: number }
  | { kind: 'already_member'; status: MembershipStatus }
  /** A concurrent request created an account with this email first. */
  | { kind: 'email_taken' };

/** Writes that would leave the workspace without an active owner are rolled back. */
export type MemberChangeResult =
  | { kind: 'ok'; member: MemberRecord }
  | { kind: 'last_owner' }
  | { kind: 'limit_reached'; activeMembers: number };

/**
 * Persistence port of the team module. Every method is scoped to one
 * workspace and owns its transaction.
 */
export abstract class TeamStore {
  /** System roles plus the custom roles of this workspace. */
  abstract listRoles(workspaceId: string): Promise<RoleRecord[]>;
  /** A system role or a custom role of this workspace; null otherwise. */
  abstract findRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RoleRecord | null>;
  abstract createRole(
    workspaceId: string,
    data: RoleWrite,
  ): Promise<RoleRecord | 'key_taken'>;
  abstract updateRole(
    workspaceId: string,
    roleId: string,
    data: Partial<RoleWrite>,
  ): Promise<RoleRecord | 'key_taken'>;
  /** Refuses while memberships or invitations reference the role. */
  abstract deleteRole(
    workspaceId: string,
    roleId: string,
  ): Promise<{ kind: 'deleted' } | { kind: 'in_use'; members: number }>;

  abstract listMembers(
    workspaceId: string,
    filter: MemberFilter,
  ): Promise<{ items: MemberRecord[]; total: number }>;
  abstract findMember(
    workspaceId: string,
    memberId: string,
  ): Promise<MemberRecord | null>;
  abstract countActiveMembers(workspaceId: string): Promise<number>;
  abstract findUserByEmail(
    email: string,
  ): Promise<{ id: string; displayName: string; status: UserStatus } | null>;
  /** Names shown in team emails. */
  abstract emailNames(
    workspaceId: string,
    actorUserId: string,
  ): Promise<{ workspaceName: string; actorName: string }>;

  /** Counts and inserts under a lock on the workspace row (plan limit). */
  abstract addMember(input: NewMember): Promise<AddMemberResult>;
  /** Replaces the member's role(s) with exactly this one. */
  abstract replaceRole(
    workspaceId: string,
    memberId: string,
    roleId: string,
    assignedById: string,
  ): Promise<MemberChangeResult>;
  abstract setStatus(
    workspaceId: string,
    memberId: string,
    status: MembershipStatus,
    now: Date,
    maxActiveMembers: number | null,
  ): Promise<MemberChangeResult>;
  /** Only while the user still has a temporary password. Returns false otherwise. */
  abstract resetTemporaryPassword(
    userId: string,
    passwordHash: string,
  ): Promise<boolean>;
}
