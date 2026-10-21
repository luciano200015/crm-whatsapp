import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  isValidObjectId,
  Types,
  type Model,
  type ModifyResult,
  type QueryFilter,
} from 'mongoose';
import {
  afterCursor,
  escapeRegex,
  toPage,
  type CursorPage,
} from '../../../database/mongodb/pagination';
import type { MessageType } from '../../channels/domain/whatsapp-payload';
import type { InboxScope } from '../domain/inbox-rules';
import {
  InboxStore,
  type Assignee,
  type ConversationEventKind,
  type ConversationQuery,
  type ConversationRecord,
  type ConversationStatus,
  type InboxCounts,
  type LastMessage,
  type MessageRecord,
  type MessageStatus,
  type NewMessage,
} from '../application/ports';
import {
  CONVERSATION_MODEL,
  MESSAGE_MODEL,
  type ConversationDocument,
  type MessageDocument,
} from './inbox.schemas';

const DUPLICATE_KEY = 11000;
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === DUPLICATE_KEY;

const objectId = (id: string): Types.ObjectId | null =>
  isValidObjectId(id) ? new Types.ObjectId(id) : null;

type ConversationFilter = QueryFilter<ConversationDocument>;

function toConversation(doc: ConversationDocument): ConversationRecord {
  return {
    id: doc._id.toHexString(),
    workspaceId: doc.workspaceId,
    lineId: doc.lineId,
    contactId: doc.contactId,
    contact: { name: doc.contact.name, phone: doc.contact.phone },
    status: doc.status,
    assignee: doc.assignee
      ? {
          membershipId: doc.assignee.membershipId,
          userId: doc.assignee.userId,
          name: doc.assignee.name,
        }
      : null,
    lastMessage: doc.lastMessage
      ? {
          text: doc.lastMessage.text,
          type: doc.lastMessage.type as MessageType,
          direction: doc.lastMessage.direction,
          at: doc.lastMessage.at,
        }
      : null,
    lastActivityAt: doc.lastActivityAt,
    lastInboundAt: doc.lastInboundAt,
    unreadCount: doc.unreadCount,
    closedAt: doc.closedAt,
    createdAt: doc.createdAt,
  };
}

function toMessage(doc: MessageDocument): MessageRecord {
  return {
    id: doc._id.toHexString(),
    conversationId: doc.conversationId.toHexString(),
    direction: doc.direction,
    type: doc.type as MessageType,
    text: doc.text,
    media: doc.media,
    location: doc.location ?? null,
    event: doc.event
      ? {
          kind: doc.event.kind as ConversationEventKind,
          by: doc.event.by,
          from: doc.event.from,
          to: doc.event.to,
        }
      : null,
    waMessageId: doc.waMessageId,
    status: doc.status as MessageStatus,
    error: doc.error,
    sentBy: doc.sentBy,
    createdAt: doc.createdAt,
  };
}

/** Conversations a member may see (see canSee in inbox-rules). */
function scopeFilter(scope: InboxScope): ConversationFilter | null {
  if (scope.viewAll) return null;
  return {
    $or: [
      { 'assignee.membershipId': scope.membershipId },
      { assignee: null, lineId: { $in: [...scope.lineIds] } },
    ],
  };
}

/** Newest activity first; the cursor is "<lastActivityAt ms>_<id>". */
function activityCursor(cursor: string | undefined): ConversationFilter | null {
  const [ms, id] = cursor?.split('_') ?? [];
  const at = Number(ms);
  if (!id || !Number.isFinite(at) || !isValidObjectId(id)) return null;
  const date = new Date(at);
  return {
    $or: [
      { lastActivityAt: { $lt: date } },
      { lastActivityAt: date, _id: { $lt: new Types.ObjectId(id) } },
    ],
  };
}

@Injectable()
export class MongoInboxStore extends InboxStore implements OnModuleInit {
  constructor(
    @InjectModel(CONVERSATION_MODEL)
    private readonly conversations: Model<ConversationDocument>,
    @InjectModel(MESSAGE_MODEL)
    private readonly messages: Model<MessageDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.conversations.createIndexes(),
      this.messages.createIndexes(),
    ]);
  }

  // ─────────────────────────── Conversations ───────────────────────────

  async listConversations(
    workspaceId: string,
    query: ConversationQuery,
  ): Promise<CursorPage<ConversationRecord>> {
    const search = query.search?.trim();
    const digits = search?.replace(/\D/g, '');
    const conditions = [
      scopeFilter(query.scope),
      query.view === 'mine'
        ? { 'assignee.membershipId': query.scope.membershipId }
        : query.view === 'unassigned'
          ? { assignee: null }
          : null,
      search
        ? {
            $or: [
              { 'contact.name': new RegExp(escapeRegex(search), 'i') },
              ...(digits
                ? [{ 'contact.phone': new RegExp(escapeRegex(digits)) }]
                : []),
            ],
          }
        : null,
      activityCursor(query.cursor),
    ].filter(
      (condition): condition is ConversationFilter => condition !== null,
    );

    const rows = await this.conversations
      .find({
        workspaceId,
        ...(query.status !== 'ALL' && { status: query.status }),
        ...(query.lineId && { lineId: query.lineId }),
        ...(query.contactId && { contactId: query.contactId }),
        ...(conditions.length > 0 && { $and: conditions }),
      })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<ConversationDocument[]>();

    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toConversation),
      nextCursor:
        rows.length > query.limit && last
          ? `${last.lastActivityAt.getTime()}_${last._id.toHexString()}`
          : null,
    };
  }

  async counts(workspaceId: string, scope: InboxScope): Promise<InboxCounts> {
    const visible = scopeFilter(scope) ?? {};
    const open = { workspaceId, status: 'OPEN' as const };
    const [mine, unassigned, all, unread, closed] = await Promise.all([
      this.conversations.countDocuments({
        ...open,
        'assignee.membershipId': scope.membershipId,
      }),
      this.conversations.countDocuments({
        ...open,
        $and: [visible, { assignee: null }],
      }),
      this.conversations.countDocuments({ ...open, ...visible }),
      this.conversations.aggregate<{ total: number }>([
        { $match: { ...open, ...visible } },
        { $group: { _id: null, total: { $sum: '$unreadCount' } } },
      ]),
      this.conversations.countDocuments({
        workspaceId,
        status: 'CLOSED',
        ...visible,
      }),
    ]);
    return { mine, unassigned, all, closed, unread: unread[0]?.total ?? 0 };
  }

  async findConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const doc = await this.conversations
      .findOne({ workspaceId, _id })
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
  }

  async openConversation(
    workspaceId: string,
    input: {
      lineId: string;
      contactId: string;
      contact: { name: string | null; phone: string };
      at: Date;
    },
  ): Promise<{ conversation: ConversationRecord; created: boolean }> {
    const filter = {
      workspaceId,
      lineId: input.lineId,
      contactId: input.contactId,
      status: 'OPEN' as const,
    };
    try {
      const result = await this.conversations
        .findOneAndUpdate(
          filter,
          {
            // The other fields come from the filter on insert.
            $setOnInsert: {
              contact: input.contact,
              assignee: null,
              lastMessage: null,
              lastActivityAt: input.at,
              lastInboundAt: null,
              unreadCount: 0,
              closedAt: null,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            includeResultMetadata: true,
          },
        )
        .lean<ModifyResult<ConversationDocument>>();
      const doc = result.value;
      if (!doc) throw new Error('Upsert returned no conversation');
      return {
        conversation: toConversation(doc),
        created: !result.lastErrorObject?.updatedExisting,
      };
    } catch (error: unknown) {
      // Two messages of a new contact arrived at once: the other one created it.
      if (!isDuplicateKey(error)) throw error;
      const doc = await this.conversations
        .findOne(filter)
        .lean<ConversationDocument>();
      if (!doc) throw error;
      return { conversation: toConversation(doc), created: false };
    }
  }

  async recordActivity(
    workspaceId: string,
    conversationId: string,
    activity: { lastMessage: LastMessage; inbound: boolean },
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const { lastMessage, inbound } = activity;
    const doc = await this.conversations
      .findOneAndUpdate(
        { workspaceId, _id },
        inbound
          ? {
              $set: {
                lastMessage,
                lastActivityAt: lastMessage.at,
                lastInboundAt: lastMessage.at,
              },
              $inc: { unreadCount: 1 },
            }
          : {
              // Replying means the agent read the conversation.
              $set: {
                lastMessage,
                lastActivityAt: lastMessage.at,
                unreadCount: 0,
              },
            },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
  }

  async setAssignee(
    workspaceId: string,
    conversationId: string,
    assignee: Assignee | null,
    options: { onlyIfUnassigned?: boolean } = {},
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const doc = await this.conversations
      .findOneAndUpdate(
        {
          workspaceId,
          _id,
          ...(options.onlyIfUnassigned && { assignee: null }),
        },
        { $set: { assignee } },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
  }

  async setStatus(
    workspaceId: string,
    conversationId: string,
    status: ConversationStatus,
    at: Date,
  ): Promise<ConversationRecord | 'already_open' | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    try {
      const doc = await this.conversations
        .findOneAndUpdate(
          { workspaceId, _id },
          status === 'CLOSED'
            ? { $set: { status, closedAt: at, unreadCount: 0 } }
            : { $set: { status, closedAt: null, lastActivityAt: at } },
          { returnDocument: 'after' },
        )
        .lean<ConversationDocument>();
      return doc ? toConversation(doc) : null;
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'already_open';
      throw error;
    }
  }

  async markRead(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const doc = await this.conversations
      .findOneAndUpdate(
        { workspaceId, _id },
        { $set: { unreadCount: 0 } },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
  }

  async markUnread(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    // Only when nothing is unread: never lowers a real count.
    const doc = await this.conversations
      .findOneAndUpdate(
        { workspaceId, _id, unreadCount: { $lt: 1 } },
        { $set: { unreadCount: 1 } },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc
      ? toConversation(doc)
      : this.findConversation(workspaceId, conversationId);
  }

  // ─────────────────────────── Messages ───────────────────────────

  async insertMessage(
    workspaceId: string,
    message: NewMessage,
  ): Promise<MessageRecord | 'duplicate'> {
    try {
      const doc = await this.messages.create({
        workspaceId,
        ...message,
        conversationId: new Types.ObjectId(message.conversationId),
      });
      return toMessage(doc.toObject());
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'duplicate';
      throw error;
    }
  }

  async listMessages(
    workspaceId: string,
    conversationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<MessageRecord>> {
    const conversation = objectId(conversationId);
    if (!conversation) return { items: [], nextCursor: null };
    const rows = await this.messages
      .find({
        workspaceId,
        conversationId: conversation,
        ...afterCursor(cursor),
      })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<MessageDocument[]>();
    return toPage(rows, limit, toMessage);
  }

  async updateMessage(
    workspaceId: string,
    messageId: string,
    changes: {
      status: MessageStatus;
      waMessageId?: string;
      error?: string | null;
      mediaId?: string;
    },
  ): Promise<MessageRecord | null> {
    const _id = objectId(messageId);
    if (!_id) return null;
    const { mediaId, ...rest } = changes;
    const doc = await this.messages
      .findOneAndUpdate(
        { workspaceId, _id },
        { $set: { ...rest, ...(mediaId && { 'media.id': mediaId }) } },
        { returnDocument: 'after' },
      )
      .lean<MessageDocument>();
    return doc ? toMessage(doc) : null;
  }

  async findMessage(
    workspaceId: string,
    messageId: string,
  ): Promise<MessageRecord | null> {
    const _id = objectId(messageId);
    if (!_id) return null;
    const doc = await this.messages
      .findOne({ workspaceId, _id })
      .lean<MessageDocument>();
    return doc ? toMessage(doc) : null;
  }

  async setMediaFile(
    workspaceId: string,
    messageId: string,
    file: { fileId: string; size: number; mimeType: string },
  ): Promise<MessageRecord | null> {
    const _id = objectId(messageId);
    if (!_id) return null;
    const doc = await this.messages
      .findOneAndUpdate(
        { workspaceId, _id, media: { $ne: null } },
        {
          $set: {
            'media.fileId': file.fileId,
            'media.size': file.size,
            'media.mimeType': file.mimeType,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<MessageDocument>();
    return doc ? toMessage(doc) : null;
  }

  async findMessageByWaId(
    workspaceId: string,
    waMessageId: string,
  ): Promise<MessageRecord | null> {
    const doc = await this.messages
      .findOne({ workspaceId, waMessageId })
      .lean<MessageDocument>();
    return doc ? toMessage(doc) : null;
  }
}
