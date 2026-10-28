import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/postgres/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import {
  ChatSettingsStore,
  type ChatSettings,
  type StoredChatSettings,
} from '../application/chat-settings';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Under `chat` in workspaces.settings, next to whatever else is stored there. */
@Injectable()
export class PrismaChatSettingsStore extends ChatSettingsStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async get(workspaceId: string): Promise<StoredChatSettings> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const chat = isObject(workspace?.settings)
      ? workspace.settings.chat
      : undefined;
    return isObject(chat) ? chat : {};
  }

  async save(workspaceId: string, settings: ChatSettings): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const current = isObject(workspace?.settings) ? workspace.settings : {};
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          settings: {
            ...current,
            chat: settings,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
