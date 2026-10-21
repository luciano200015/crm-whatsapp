import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';

export interface QuickReplyRecord {
  id: string;
  /** Typed after "/" in the chat, e.g. "saludo". */
  shortcut: string;
  text: string;
  createdBy: { userId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Saved answers of a workspace (MongoDB, collection quick_replies). */
export abstract class QuickRepliesStore {
  abstract list(workspaceId: string): Promise<QuickReplyRecord[]>;
  /** 'shortcut_taken' when the workspace already uses that shortcut. */
  abstract create(
    workspaceId: string,
    data: {
      shortcut: string;
      text: string;
      createdBy: { userId: string; name: string };
    },
  ): Promise<QuickReplyRecord | 'shortcut_taken'>;
  abstract update(
    workspaceId: string,
    id: string,
    data: { shortcut?: string; text?: string },
  ): Promise<QuickReplyRecord | 'shortcut_taken' | null>;
  abstract delete(workspaceId: string, id: string): Promise<boolean>;
}

/** Up to 32 lowercase letters, digits, "-" or "_" (accents removed). */
export function normalizeShortcut(raw: string): string | null {
  const shortcut = raw
    .trim()
    .replace(/^\/+/, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(shortcut) ? shortcut : null;
}

const QuickReplyErrors = {
  notFound: () =>
    new NotFoundException({
      message: 'Quick reply not found',
      code: 'QUICK_REPLY_NOT_FOUND',
    }),
  shortcutTaken: () =>
    new ConflictException({
      message: 'Another quick reply already uses this shortcut',
      code: 'QUICK_REPLY_SHORTCUT_TAKEN',
    }),
  invalidShortcut: () =>
    new UnprocessableEntityException({
      message:
        'The shortcut can only have letters, numbers, "-" and "_" (up to 32)',
      code: 'QUICK_REPLY_INVALID_SHORTCUT',
    }),
  forbidden: () =>
    new ForbiddenException('You do not have permission to do this'),
};

@Injectable()
export class QuickRepliesService {
  constructor(private readonly store: QuickRepliesStore) {}

  /** Agents use them (messages.send) and managers edit them (quick_replies.manage). */
  list(access: WorkspaceAccess): Promise<QuickReplyRecord[]> {
    if (
      !access.permissions.has('messages.send') &&
      !access.permissions.has('quick_replies.manage')
    ) {
      throw QuickReplyErrors.forbidden();
    }
    return this.store.list(access.workspaceId);
  }

  async create(
    workspaceId: string,
    input: { shortcut: string; text: string },
    by: { userId: string; name: string },
  ): Promise<QuickReplyRecord> {
    const shortcut = normalizeShortcut(input.shortcut);
    if (!shortcut) throw QuickReplyErrors.invalidShortcut();
    const created = await this.store.create(workspaceId, {
      shortcut,
      text: input.text.trim(),
      createdBy: by,
    });
    if (created === 'shortcut_taken') throw QuickReplyErrors.shortcutTaken();
    return created;
  }

  async update(
    workspaceId: string,
    id: string,
    input: { shortcut?: string; text?: string },
  ): Promise<QuickReplyRecord> {
    const shortcut =
      input.shortcut === undefined
        ? undefined
        : normalizeShortcut(input.shortcut);
    if (shortcut === null) throw QuickReplyErrors.invalidShortcut();
    const updated = await this.store.update(workspaceId, id, {
      ...(shortcut && { shortcut }),
      ...(input.text !== undefined && { text: input.text.trim() }),
    });
    if (updated === 'shortcut_taken') throw QuickReplyErrors.shortcutTaken();
    if (!updated) throw QuickReplyErrors.notFound();
    return updated;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    if (!(await this.store.delete(workspaceId, id))) {
      throw QuickReplyErrors.notFound();
    }
  }
}
