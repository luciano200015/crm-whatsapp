import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  FunnelsStore,
  type AutomationRuleRecord,
  type BoardPreferences,
  type FunnelChanges,
  type FunnelMember,
  type FunnelRecord,
  type StageRecord,
} from '../application/ports';
import type { ChatStatus } from '../domain/funnel-rules';

const STAGE_SELECT = {
  id: true,
  funnelId: true,
  name: true,
  position: true,
  createdAt: true,
} as const satisfies Prisma.FunnelStageSelect;

const FUNNEL_SELECT = {
  id: true,
  workspaceId: true,
  lineId: true,
  name: true,
  description: true,
  isPrimary: true,
  archiveAfterDays: true,
  syncRules: true,
  createdAt: true,
  updatedAt: true,
  line: { select: { name: true } },
  stages: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: STAGE_SELECT,
  },
} as const satisfies Prisma.FunnelSelect;

type FunnelRow = Prisma.FunnelGetPayload<{ select: typeof FUNNEL_SELECT }>;

const toFunnel = ({ line, ...row }: FunnelRow): FunnelRecord => ({
  ...row,
  lineName: line.name,
});

const DEFAULT_PREFERENCES: BoardPreferences = {
  showValue: false,
  showAgent: true,
};

@Injectable()
export class PrismaFunnelsStore extends FunnelsStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(workspaceId: string): Promise<FunnelRecord[]> {
    const rows = await this.prisma.funnel.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'asc' }],
      select: FUNNEL_SELECT,
    });
    return rows.map(toFunnel);
  }

  async find(
    workspaceId: string,
    funnelId: string,
  ): Promise<FunnelRecord | null> {
    const row = await this.prisma.funnel.findFirst({
      where: { id: funnelId, workspaceId },
      select: FUNNEL_SELECT,
    });
    return row ? toFunnel(row) : null;
  }

  async primaryOfLine(
    workspaceId: string,
    lineId: string,
  ): Promise<FunnelRecord | null> {
    const row = await this.prisma.funnel.findFirst({
      where: { workspaceId, lineId, isPrimary: true },
      select: FUNNEL_SELECT,
    });
    return row ? toFunnel(row) : null;
  }

  async create(
    workspaceId: string,
    input: {
      lineId: string;
      name: string;
      description: string;
      isPrimary: boolean;
      archiveAfterDays: number | null;
      stages: readonly string[];
      createdByUserId: string | null;
    },
  ): Promise<FunnelRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.funnel.updateMany({
          where: { workspaceId, lineId: input.lineId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.funnel.create({
        data: {
          workspaceId,
          lineId: input.lineId,
          name: input.name,
          description: input.description,
          isPrimary: input.isPrimary,
          archiveAfterDays: input.archiveAfterDays,
          createdByUserId: input.createdByUserId,
          stages: {
            create: input.stages.map((name, position) => ({ name, position })),
          },
        },
        select: FUNNEL_SELECT,
      });
    });
    return toFunnel(row);
  }

  async update(
    workspaceId: string,
    funnelId: string,
    changes: FunnelChanges,
  ): Promise<FunnelRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.funnel.findFirst({
        where: { id: funnelId, workspaceId },
        select: { lineId: true },
      });
      if (!current) return null;
      const lineId = changes.lineId ?? current.lineId;
      if (changes.isPrimary) {
        await tx.funnel.updateMany({
          where: {
            workspaceId,
            lineId,
            isPrimary: true,
            NOT: { id: funnelId },
          },
          data: { isPrimary: false },
        });
      }
      return tx.funnel.update({
        where: { id: funnelId },
        data: {
          ...(changes.name !== undefined && { name: changes.name }),
          ...(changes.description !== undefined && {
            description: changes.description,
          }),
          ...(changes.lineId !== undefined && { lineId: changes.lineId }),
          ...(changes.isPrimary !== undefined && {
            isPrimary: changes.isPrimary,
          }),
          ...(changes.archiveAfterDays !== undefined && {
            archiveAfterDays: changes.archiveAfterDays,
          }),
          ...(changes.syncRules !== undefined && {
            syncRules: changes.syncRules as Prisma.InputJsonValue,
          }),
        },
        select: FUNNEL_SELECT,
      });
    });
    return row ? toFunnel(row) : null;
  }

  async remove(workspaceId: string, funnelId: string): Promise<boolean> {
    const { count } = await this.prisma.funnel.deleteMany({
      where: { id: funnelId, workspaceId },
    });
    return count > 0;
  }

  async addStage(funnelId: string, name: string): Promise<StageRecord> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.funnelStage.aggregate({
        where: { funnelId },
        _max: { position: true },
      });
      return tx.funnelStage.create({
        data: { funnelId, name, position: (last._max.position ?? -1) + 1 },
        select: STAGE_SELECT,
      });
    });
  }

  async renameStage(
    funnelId: string,
    stageId: string,
    name: string,
  ): Promise<StageRecord | null> {
    const { count } = await this.prisma.funnelStage.updateMany({
      where: { id: stageId, funnelId },
      data: { name },
    });
    if (count === 0) return null;
    return this.prisma.funnelStage.findUnique({
      where: { id: stageId },
      select: STAGE_SELECT,
    });
  }

  async reorderStages(
    funnelId: string,
    stageIds: readonly string[],
  ): Promise<void> {
    await this.prisma.$transaction(
      stageIds.map((id, position) =>
        this.prisma.funnelStage.updateMany({
          where: { id, funnelId },
          data: { position },
        }),
      ),
    );
  }

  async removeStage(funnelId: string, stageId: string): Promise<boolean> {
    const { count } = await this.prisma.funnelStage.deleteMany({
      where: { id: stageId, funnelId },
    });
    return count > 0;
  }

  stageAccess(
    funnelId: string,
  ): Promise<{ membershipId: string; stageId: string }[]> {
    return this.prisma.funnelStageAccess.findMany({
      where: { funnelId },
      select: { membershipId: true, stageId: true },
    });
  }

  async memberStages(
    funnelId: string,
    membershipId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.funnelStageAccess.findMany({
      where: { funnelId, membershipId },
      select: { stageId: true },
    });
    return rows.map((row) => row.stageId);
  }

  async setStageAccess(
    funnelId: string,
    members: { membershipId: string; stageIds: string[] }[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.funnelStageAccess.deleteMany({ where: { funnelId } }),
      this.prisma.funnelStageAccess.createMany({
        data: members.flatMap((member) =>
          member.stageIds.map((stageId) => ({
            funnelId,
            membershipId: member.membershipId,
            stageId,
          })),
        ),
        skipDuplicates: true,
      }),
    ]);
  }

  async activeMembers(workspaceId: string): Promise<FunnelMember[]> {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        user: { select: { displayName: true } },
      },
    });
    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      name: row.user.displayName,
    }));
  }

  async memberName(
    workspaceId: string,
    membershipId: string,
  ): Promise<string | null> {
    const row = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId },
      select: { user: { select: { displayName: true } } },
    });
    return row?.user.displayName ?? null;
  }

  async preferences(
    userId: string,
    funnelId: string,
  ): Promise<BoardPreferences> {
    const row = await this.prisma.funnelBoardPreference.findUnique({
      where: { userId_funnelId: { userId, funnelId } },
      select: { showValue: true, showAgent: true },
    });
    return row ?? { ...DEFAULT_PREFERENCES };
  }

  setPreferences(
    userId: string,
    funnelId: string,
    preferences: BoardPreferences,
  ): Promise<BoardPreferences> {
    return this.prisma.funnelBoardPreference.upsert({
      where: { userId_funnelId: { userId, funnelId } },
      create: { userId, funnelId, ...preferences },
      update: preferences,
      select: { showValue: true, showAgent: true },
    });
  }

  async rules(
    workspaceId: string,
    lineId: string,
  ): Promise<AutomationRuleRecord[]> {
    const rows = await this.prisma.funnelAutomationRule.findMany({
      where: { lineId, line: { workspaceId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        lineId: true,
        status: true,
        funnelId: true,
        stageId: true,
      },
    });
    return rows.map((row) => ({ ...row, status: row.status as ChatStatus }));
  }

  async setRules(
    workspaceId: string,
    lineId: string,
    rules: { status: ChatStatus; funnelId: string; stageId: string }[],
  ): Promise<AutomationRuleRecord[]> {
    await this.prisma.$transaction([
      this.prisma.funnelAutomationRule.deleteMany({
        where: { lineId, line: { workspaceId } },
      }),
      this.prisma.funnelAutomationRule.createMany({
        data: rules.map((rule) => ({ lineId, ...rule })),
      }),
    ]);
    return this.rules(workspaceId, lineId);
  }

  async ruleFor(
    workspaceId: string,
    lineId: string,
    status: ChatStatus,
  ): Promise<AutomationRuleRecord | null> {
    const row = await this.prisma.funnelAutomationRule.findFirst({
      where: { lineId, status, line: { workspaceId } },
      select: {
        id: true,
        lineId: true,
        status: true,
        funnelId: true,
        stageId: true,
      },
    });
    return row ? { ...row, status: row.status as ChatStatus } : null;
  }

  async withAutoArchive(): Promise<
    { id: string; workspaceId: string; archiveAfterDays: number }[]
  > {
    const rows = await this.prisma.funnel.findMany({
      where: { archiveAfterDays: { not: null } },
      select: { id: true, workspaceId: true, archiveAfterDays: true },
    });
    return rows.flatMap((row) =>
      row.archiveAfterDays === null
        ? []
        : [{ ...row, archiveAfterDays: row.archiveAfterDays }],
    );
  }
}
