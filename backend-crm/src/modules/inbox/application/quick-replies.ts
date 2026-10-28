import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import { InboxErrors } from './inbox-errors';
import {
  baseMimeType,
  MediaStore,
  outgoingMedia,
  sanitizeFilename,
} from './media';

/** A file sent after the text of the quick reply (stored in GridFS). */
export interface QuickReplyAttachment {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export const MAX_QUICK_REPLY_ATTACHMENTS = 5;

export interface QuickReplyRecord {
  id: string;
  /** What the agent searches and sees, e.g. «Lavadoras monstruosas». */
  title: string;
  /** Unique key derived from the title (older replies typed it after "/"). */
  shortcut: string;
  text: string;
  attachments: QuickReplyAttachment[];
  createdBy: { userId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuickReplyWrite {
  title: string;
  shortcut: string;
  text: string;
  attachments: QuickReplyAttachment[];
}

/** Saved answers of a workspace (MongoDB, collection quick_replies). */
export abstract class QuickRepliesStore {
  abstract list(workspaceId: string): Promise<QuickReplyRecord[]>;
  abstract find(
    workspaceId: string,
    id: string,
  ): Promise<QuickReplyRecord | null>;
  /** 'shortcut_taken' when the workspace already uses that title. */
  abstract create(
    workspaceId: string,
    data: QuickReplyWrite & { createdBy: { userId: string; name: string } },
  ): Promise<QuickReplyRecord | 'shortcut_taken'>;
  abstract update(
    workspaceId: string,
    id: string,
    data: Partial<QuickReplyWrite>,
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

/** «Lavadoras Monstruosas 🎃» → "lavadoras-monstruosas": titles are unique. */
export function titleKey(title: string): string | null {
  const key = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return key || null;
}

const QuickReplyErrors = {
  notFound: () =>
    new NotFoundException({
      message: 'Quick reply not found',
      code: 'QUICK_REPLY_NOT_FOUND',
    }),
  shortcutTaken: () =>
    new ConflictException({
      message: 'Another quick reply already uses this title',
      code: 'QUICK_REPLY_SHORTCUT_TAKEN',
    }),
  invalidShortcut: () =>
    new UnprocessableEntityException({
      message:
        'The shortcut can only have letters, numbers, "-" and "_" (up to 32)',
      code: 'QUICK_REPLY_INVALID_SHORTCUT',
    }),
  invalidTitle: () =>
    new UnprocessableEntityException({
      message: 'The title needs at least one letter or number',
      code: 'QUICK_REPLY_INVALID_TITLE',
    }),
  titleRequired: () =>
    new UnprocessableEntityException({
      message: 'Give the quick reply a title',
      code: 'QUICK_REPLY_TITLE_REQUIRED',
    }),
  attachmentNotFound: () =>
    new UnprocessableEntityException({
      message: 'An attached file does not exist: upload it again',
      code: 'QUICK_REPLY_ATTACHMENT_NOT_FOUND',
    }),
  forbidden: () =>
    new ForbiddenException('You do not have permission to do this'),
};

export interface QuickReplyInput {
  title?: string;
  /** Older clients: the "/" shortcut, also used as title. */
  shortcut?: string;
  text: string;
  attachmentIds?: string[];
}

@Injectable()
export class QuickRepliesService {
  constructor(
    private readonly store: QuickRepliesStore,
    private readonly media: MediaStore,
  ) {}

  /** Agents use them (messages.send) and managers edit them (quick_replies.manage). */
  list(access: WorkspaceAccess): Promise<QuickReplyRecord[]> {
    this.assertCanUse(access);
    return this.store.list(access.workspaceId);
  }

  async get(access: WorkspaceAccess, id: string): Promise<QuickReplyRecord> {
    this.assertCanUse(access);
    const reply = await this.store.find(access.workspaceId, id);
    if (!reply) throw QuickReplyErrors.notFound();
    return reply;
  }

  /** Stores a file to attach to a quick reply; same limits as sending it. */
  async upload(
    workspaceId: string,
    file: { buffer: Buffer; mimeType: string; filename: string; size: number },
  ): Promise<QuickReplyAttachment> {
    const checked = outgoingMedia(file.mimeType, file.size);
    if ('error' in checked) {
      throw checked.error === 'too_large'
        ? InboxErrors.mediaTooLarge(checked.maxBytes)
        : InboxErrors.unsupportedMedia();
    }
    const mimeType = baseMimeType(file.mimeType);
    const filename =
      sanitizeFilename(file.filename) ?? `archivo.${checked.type}`;
    const stored = await this.media.put(workspaceId, {
      body: file.buffer,
      mimeType,
      filename,
    });
    return { fileId: stored.fileId, filename, mimeType, size: stored.size };
  }

  async create(
    workspaceId: string,
    input: QuickReplyInput,
    by: { userId: string; name: string },
  ): Promise<QuickReplyRecord> {
    const { title, shortcut } = this.identity(input);
    const created = await this.store.create(workspaceId, {
      title,
      shortcut,
      text: input.text.trim(),
      attachments: await this.attachments(workspaceId, input.attachmentIds),
      createdBy: by,
    });
    if (created === 'shortcut_taken') throw QuickReplyErrors.shortcutTaken();
    return created;
  }

  async update(
    workspaceId: string,
    id: string,
    input: Partial<QuickReplyInput>,
  ): Promise<QuickReplyRecord> {
    const renamed =
      input.title !== undefined || input.shortcut !== undefined
        ? this.identity(input)
        : null;
    const updated = await this.store.update(workspaceId, id, {
      ...(renamed ?? {}),
      ...(input.text !== undefined && { text: input.text.trim() }),
      ...(input.attachmentIds !== undefined && {
        attachments: await this.attachments(workspaceId, input.attachmentIds),
      }),
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

  private assertCanUse(access: WorkspaceAccess) {
    if (
      !access.permissions.has('messages.send') &&
      !access.permissions.has('quick_replies.manage')
    ) {
      throw QuickReplyErrors.forbidden();
    }
  }

  /** The title, and the unique key that comes from it. */
  private identity(input: Partial<QuickReplyInput>) {
    const title = input.title?.trim();
    if (title) {
      const key = titleKey(title);
      if (!key) throw QuickReplyErrors.invalidTitle();
      return { title, shortcut: key };
    }
    if (input.shortcut === undefined) throw QuickReplyErrors.titleRequired();
    const shortcut = normalizeShortcut(input.shortcut);
    if (!shortcut) throw QuickReplyErrors.invalidShortcut();
    return { title: shortcut, shortcut };
  }

  /** Files uploaded to this workspace, described as stored. */
  private async attachments(
    workspaceId: string,
    fileIds: string[] = [],
  ): Promise<QuickReplyAttachment[]> {
    const result: QuickReplyAttachment[] = [];
    for (const fileId of [...new Set(fileIds)]) {
      const file = await this.media.open(workspaceId, fileId);
      if (!file) throw QuickReplyErrors.attachmentNotFound();
      file.stream.destroy();
      result.push({
        fileId,
        filename: file.filename ?? 'archivo',
        mimeType: file.mimeType,
        size: file.size,
      });
    }
    return result;
  }
}
