import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/postgres/prisma.service';
import type { RequestContext } from '../../shared/http/request-context';
import { AuditService } from '../audit/audit.service';
import {
  effectiveStatus,
  hasFullAccess,
  trialDaysLeft,
  type SubscriptionTimeline,
} from '../billing/domain/subscription-rules';
import type { MeDto, UpdateMeDto, WorkspacePlanDto } from './users.dto';

/** Read/update of the caller's own profile. No other user is reachable here. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        avatarUrl: true,
        locale: true,
        timezone: true,
        createdAt: true,
        lastLoginAt: true,
        memberships: {
          orderBy: { joinedAt: 'asc' },
          select: {
            status: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                subscription: {
                  select: {
                    status: true,
                    trialEndsAt: true,
                    currentPeriodEnd: true,
                    cancelAtPeriodEnd: true,
                    plan: { select: { code: true, name: true } },
                  },
                },
              },
            },
            roles: {
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: {
                      select: { permission: { select: { key: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const { emailVerifiedAt, memberships, ...profile } = user;
    return {
      ...profile,
      emailVerified: emailVerifiedAt !== null,
      workspaces: memberships.map(
        ({ workspace: { subscription, ...workspace }, ...membership }) => ({
          ...workspace,
          plan: subscription ? planSummary(subscription, now) : null,
          membershipStatus: membership.status,
          roles: membership.roles.map(({ role }) => role.key).sort(),
          permissions: [
            ...new Set(
              membership.roles.flatMap(({ role }) =>
                role.permissions.map(({ permission }) => permission.key),
              ),
            ),
          ].sort(),
        }),
      ),
    };
  }

  async updateMe(
    userId: string,
    dto: UpdateMeDto,
    context: RequestContext,
  ): Promise<MeDto> {
    const changed = Object.keys(dto).filter(
      (key) => dto[key as keyof UpdateMeDto] !== undefined,
    );
    if (changed.length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          displayName: dto.displayName,
          locale: dto.locale,
          timezone: dto.timezone,
          avatarUrl: dto.avatarUrl,
        },
      });
      await this.audit.record({
        action: 'user.profile.updated',
        actorUserId: userId,
        targetType: 'user',
        targetId: userId,
        context,
        metadata: { fields: changed },
      });
    }
    return this.getMe(userId);
  }
}

function planSummary(
  subscription: SubscriptionTimeline & { plan: { code: string; name: string } },
  now: Date,
): WorkspacePlanDto {
  const status = effectiveStatus(subscription, now);
  return {
    code: subscription.plan.code,
    name: subscription.plan.name,
    status,
    hasFullAccess: hasFullAccess(status),
    trialEndsAt: subscription.trialEndsAt,
    trialDaysLeft: trialDaysLeft(subscription, now),
  };
}
