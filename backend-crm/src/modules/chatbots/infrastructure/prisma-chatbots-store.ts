import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  ChatbotsStore,
  type ChatbotChanges,
  type ChatbotRecord,
  type SetLinesResult,
} from '../application/ports';

const CHATBOT_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  enabled: true,
  graph: true,
  schedule: true,
  restartAfterMinutes: true,
  createdAt: true,
  updatedAt: true,
  lines: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true } },
} as const satisfies Prisma.ChatbotSelect;

type ChatbotRow = Prisma.ChatbotGetPayload<{ select: typeof CHATBOT_SELECT }>;

const toChatbot = (row: ChatbotRow): ChatbotRecord => ({ ...row });

const json = (value: unknown) => value as Prisma.InputJsonValue;
const nullableJson = (value: unknown) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

@Injectable()
export class PrismaChatbotsStore extends ChatbotsStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(workspaceId: string): Promise<ChatbotRecord[]> {
    const rows = await this.prisma.chatbot.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: CHATBOT_SELECT,
    });
    return rows.map(toChatbot);
  }

  async find(
    workspaceId: string,
    chatbotId: string,
  ): Promise<ChatbotRecord | null> {
    const row = await this.prisma.chatbot.findFirst({
      where: { id: chatbotId, workspaceId },
      select: CHATBOT_SELECT,
    });
    return row ? toChatbot(row) : null;
  }

  async create(
    workspaceId: string,
    input: { name: string; graph: unknown; createdByUserId: string | null },
  ): Promise<ChatbotRecord> {
    const row = await this.prisma.chatbot.create({
      data: {
        workspaceId,
        name: input.name,
        graph: json(input.graph),
        createdByUserId: input.createdByUserId,
      },
      select: CHATBOT_SELECT,
    });
    return toChatbot(row);
  }

  async update(
    workspaceId: string,
    chatbotId: string,
    changes: ChatbotChanges,
  ): Promise<ChatbotRecord | null> {
    const { count } = await this.prisma.chatbot.updateMany({
      where: { id: chatbotId, workspaceId },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.enabled !== undefined && { enabled: changes.enabled }),
        ...(changes.graph !== undefined && { graph: json(changes.graph) }),
        ...(changes.schedule !== undefined && {
          schedule: nullableJson(changes.schedule),
        }),
        ...(changes.restartAfterMinutes !== undefined && {
          restartAfterMinutes: changes.restartAfterMinutes,
        }),
      },
    });
    return count === 0 ? null : this.find(workspaceId, chatbotId);
  }

  async remove(workspaceId: string, chatbotId: string): Promise<boolean> {
    // Its lines are left without a chatbot (ON DELETE SET NULL).
    const { count } = await this.prisma.chatbot.deleteMany({
      where: { id: chatbotId, workspaceId },
    });
    return count > 0;
  }

  async setLines(
    workspaceId: string,
    chatbotId: string,
    lineIds: string[],
    takeOver: boolean,
  ): Promise<SetLinesResult> {
    return this.prisma.$transaction(async (tx) => {
      const bot = await tx.chatbot.findFirst({
        where: { id: chatbotId, workspaceId },
        select: { id: true },
      });
      if (!bot) return { kind: 'chatbot_not_found' as const };
      const lines = await tx.channelLine.findMany({
        where: { workspaceId, id: { in: lineIds } },
        select: {
          id: true,
          name: true,
          chatbotId: true,
          chatbot: { select: { name: true } },
        },
      });
      if (lines.length !== lineIds.length)
        return { kind: 'line_not_found' as const };
      const taken = lines.find(
        (line) => line.chatbotId && line.chatbotId !== chatbotId,
      );
      if (taken && !takeOver) {
        return {
          kind: 'line_taken' as const,
          lineId: taken.id,
          lineName: taken.name,
          chatbot: taken.chatbot?.name ?? '',
        };
      }
      await tx.channelLine.updateMany({
        where: { workspaceId, chatbotId, id: { notIn: lineIds } },
        data: { chatbotId: null },
      });
      await tx.channelLine.updateMany({
        where: { workspaceId, id: { in: lineIds } },
        data: { chatbotId },
      });
      const row = await tx.chatbot.findFirstOrThrow({
        where: { id: chatbotId, workspaceId },
        select: CHATBOT_SELECT,
      });
      return toChatbot(row);
    });
  }
}
