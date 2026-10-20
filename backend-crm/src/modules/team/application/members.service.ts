import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { Mailer, type MailMessage } from '../../../shared/mail/mailer';
import { generateTemporaryPassword } from '../../../shared/security/temporary-password';
import { Clock } from '../../../shared/time/clock';
import { AuditService } from '../../audit/audit.service';
import { PasswordHasher } from '../../auth/application/ports';
import { normalizeEmail } from '../../auth/domain/email';
import type { PermissionKey } from '../../authorization/domain/permission-catalog';
import {
  type MemberChangeResult,
  type MemberFilter,
  type MemberRecord,
  type MembershipStatus,
  type NewMemberUser,
  type RoleRecord,
  TeamStore,
  WorkspaceEntitlements,
} from './ports';
import {
  agentLimit,
  assertCustomRolesIncluded,
  assertHolds,
  requirePlan,
  type TeamActor,
} from './team-access';
import { teamEmails } from './team-emails';
import { TeamErrors } from './team-errors';

export interface MemberView {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: MembershipStatus;
  /** Has not replaced the temporary password yet. */
  pendingFirstAccess: boolean;
  lastLoginAt: Date | null;
  joinedAt: Date;
  deactivatedAt: Date | null;
  role: { id: string; key: string; name: string; system: boolean } | null;
  permissions: PermissionKey[];
}

export interface MemberListView {
  items: MemberView[];
  total: number;
  /** Active members against limits.agents (null = unlimited). */
  usage: { activeMembers: number; limit: number | null };
}

export interface NewMemberInput {
  email: string;
  displayName: string;
  roleId: string;
}

/**
 * Members (agents) of a workspace: created by an admin with a temporary
 * password, role changes, deactivation. Plan limits and anti-escalation rules
 * are enforced here; the workspace always comes from the access guard.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly store: TeamStore,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly passwords: PasswordHasher,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
  ) {}

  async list(
    workspaceId: string,
    filter: MemberFilter,
  ): Promise<MemberListView> {
    const [page, activeMembers, plan] = await Promise.all([
      this.store.listMembers(workspaceId, filter),
      this.store.countActiveMembers(workspaceId),
      this.entitlements.entitlements(workspaceId),
    ]);
    return {
      items: page.items.map(toMemberView),
      total: page.total,
      usage: { activeMembers, limit: plan ? agentLimit(plan) : null },
    };
  }

  async get(workspaceId: string, memberId: string): Promise<MemberView> {
    return toMemberView(await this.requireMember(workspaceId, memberId));
  }

  /**
   * New email: creates the account with a random temporary password, emailed
   * once. Existing account: only adds the membership (its password is untouched).
   */
  async create(actor: TeamActor, input: NewMemberInput): Promise<MemberView> {
    const { workspaceId } = actor.access;
    const role = await this.requireRole(workspaceId, input.roleId);
    assertHolds(actor, role.permissions);

    const plan = await requirePlan(this.entitlements, workspaceId);
    if (!plan.hasFullAccess) throw TeamErrors.subscriptionInactive();
    if (role.workspaceId !== null) assertCustomRolesIncluded(plan);

    const email = normalizeEmail(input.email);
    const existing = await this.store.findUserByEmail(email);
    let temporaryPassword: string | null = null;
    let user: NewMemberUser;
    if (existing) {
      user = { kind: 'existing', userId: existing.id };
    } else {
      temporaryPassword = generateTemporaryPassword();
      user = {
        kind: 'new',
        email,
        displayName: input.displayName.trim(),
        passwordHash: await this.passwords.hash(temporaryPassword),
      };
    }

    const limit = agentLimit(plan);
    const result = await this.store.addMember({
      workspaceId,
      user,
      roleId: role.id,
      invitedById: actor.userId,
      maxActiveMembers: limit,
    });
    switch (result.kind) {
      case 'already_member':
        throw result.status === 'ACTIVE'
          ? TeamErrors.memberAlreadyExists()
          : TeamErrors.memberDeactivated();
      case 'limit_reached':
        throw TeamErrors.agentLimitReached({
          plan: plan.planName,
          limit: limit ?? 0,
          usage: result.activeMembers,
        });
      case 'email_taken':
        // Lost a race against a sign-up with the same email: retry as existing.
        return this.create(actor, input);
    }

    const { member } = result;
    const names = await this.store.emailNames(workspaceId, actor.userId);
    const webAppUrl = this.config.get('WEB_APP_URL');
    this.sendInBackground(
      temporaryPassword
        ? teamEmails.newMemberAccess({
            to: email,
            displayName: member.user.displayName,
            workspaceName: names.workspaceName,
            invitedBy: names.actorName,
            temporaryPassword,
            webAppUrl,
          })
        : teamEmails.addedToWorkspace({
            to: email,
            workspaceName: names.workspaceName,
            invitedBy: names.actorName,
            webAppUrl,
          }),
    );
    await this.audit.record({
      action: temporaryPassword ? 'team.member.created' : 'team.member.added',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'membership',
      targetId: member.id,
      context: actor.context,
      metadata: { userId: member.userId, role: role.key },
    });
    return toMemberView(member);
  }

  async changeRole(
    actor: TeamActor,
    memberId: string,
    roleId: string,
  ): Promise<MemberView> {
    const { workspaceId } = actor.access;
    const member = await this.requireManageable(actor, memberId);
    const role = await this.requireRole(workspaceId, roleId);
    assertHolds(actor, role.permissions);
    if (role.workspaceId !== null) {
      assertCustomRolesIncluded(
        await requirePlan(this.entitlements, workspaceId),
      );
    }
    const current = member.roles.map((r) => r.id);
    if (current.length === 1 && current[0] === role.id) {
      return toMemberView(member);
    }

    const updated = this.unwrap(
      await this.store.replaceRole(
        workspaceId,
        memberId,
        role.id,
        actor.userId,
      ),
    );
    await this.audit.record({
      action: 'team.member.role_changed',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'membership',
      targetId: memberId,
      context: actor.context,
      metadata: { from: member.roles.map((r) => r.key), to: role.key },
    });
    return toMemberView(updated);
  }

  /** Access to this workspace ends on the member's next request. */
  async deactivate(actor: TeamActor, memberId: string): Promise<MemberView> {
    const member = await this.requireManageable(actor, memberId);
    if (member.status === 'DEACTIVATED') return toMemberView(member);

    const updated = this.unwrap(
      await this.store.setStatus(
        actor.access.workspaceId,
        memberId,
        'DEACTIVATED',
        this.clock.now(),
        null,
      ),
    );
    await this.recordStatusChange(actor, memberId, 'team.member.deactivated');
    return toMemberView(updated);
  }

  async reactivate(actor: TeamActor, memberId: string): Promise<MemberView> {
    const { workspaceId } = actor.access;
    const member = await this.requireManageable(actor, memberId);
    if (member.status === 'ACTIVE') return toMemberView(member);

    const plan = await requirePlan(this.entitlements, workspaceId);
    if (!plan.hasFullAccess) throw TeamErrors.subscriptionInactive();
    const limit = agentLimit(plan);
    const result = await this.store.setStatus(
      workspaceId,
      memberId,
      'ACTIVE',
      this.clock.now(),
      limit,
    );
    if (result.kind === 'limit_reached') {
      throw TeamErrors.agentLimitReached({
        plan: plan.planName,
        limit: limit ?? 0,
        usage: result.activeMembers,
      });
    }
    const updated = this.unwrap(result);
    await this.recordStatusChange(actor, memberId, 'team.member.reactivated');
    return toMemberView(updated);
  }

  /** New temporary password, only while the member has not chosen their own. */
  async resendAccess(actor: TeamActor, memberId: string): Promise<void> {
    const member = await this.requireManageable(actor, memberId);
    if (member.status !== 'ACTIVE') throw TeamErrors.memberInactive();
    if (!member.user.pendingFirstAccess) throw TeamErrors.accessAlreadySet();

    const temporaryPassword = generateTemporaryPassword();
    const reset = await this.store.resetTemporaryPassword(
      member.userId,
      await this.passwords.hash(temporaryPassword),
    );
    if (!reset) throw TeamErrors.accessAlreadySet();

    const names = await this.store.emailNames(
      actor.access.workspaceId,
      actor.userId,
    );
    this.sendInBackground(
      teamEmails.accessReset({
        to: member.user.email,
        workspaceName: names.workspaceName,
        temporaryPassword,
        webAppUrl: this.config.get('WEB_APP_URL'),
      }),
    );
    await this.recordStatusChange(actor, memberId, 'team.member.access_resent');
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private async requireMember(
    workspaceId: string,
    memberId: string,
  ): Promise<MemberRecord> {
    const member = await this.store.findMember(workspaceId, memberId);
    if (!member) throw TeamErrors.memberNotFound();
    return member;
  }

  /** Not yourself, and only members whose permissions you hold (an admin cannot touch an owner). */
  private async requireManageable(
    actor: TeamActor,
    memberId: string,
  ): Promise<MemberRecord> {
    const member = await this.requireMember(actor.access.workspaceId, memberId);
    if (member.userId === actor.userId) throw TeamErrors.cannotModifySelf();
    assertHolds(actor, member.permissions);
    return member;
  }

  private async requireRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RoleRecord> {
    const role = await this.store.findRole(workspaceId, roleId);
    if (!role) throw TeamErrors.roleNotFound();
    return role;
  }

  private unwrap(result: MemberChangeResult): MemberRecord {
    if (result.kind === 'last_owner') throw TeamErrors.lastOwner();
    if (result.kind === 'limit_reached') {
      // Only reactivate passes a limit, and it handles this case itself.
      throw new Error('Unexpected plan limit result');
    }
    return result.member;
  }

  private recordStatusChange(
    actor: TeamActor,
    memberId: string,
    action: string,
  ): Promise<void> {
    return this.audit.record({
      action,
      actorUserId: actor.userId,
      workspaceId: actor.access.workspaceId,
      targetType: 'membership',
      targetId: memberId,
      context: actor.context,
    });
  }

  private sendInBackground(message: MailMessage): void {
    this.mailer.send(message).catch((error: unknown) => {
      this.logger.error(
        `Failed to send "${message.subject}": ${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
      );
    });
  }
}

export function toMemberView(member: MemberRecord): MemberView {
  return {
    id: member.id,
    userId: member.userId,
    email: member.user.email,
    displayName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
    status: member.status,
    pendingFirstAccess: member.user.pendingFirstAccess,
    lastLoginAt: member.user.lastLoginAt,
    joinedAt: member.joinedAt,
    deactivatedAt: member.deactivatedAt,
    role: member.roles[0] ?? null,
    permissions: member.permissions,
  };
}
