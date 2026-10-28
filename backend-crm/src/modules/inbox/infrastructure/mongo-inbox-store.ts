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
  type BotSession,
  type ConversationBot,
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
  ONE_CONVERSATION_INDEX,
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
          messageId: doc.lastMessage.messageId ?? null,
          status: (doc.lastMessage.status as MessageStatus | null) ?? null,
        }
      : null,
    lastActivityAt: doc.lastActivityAt,
    lastInboundAt: doc.lastInboundAt,
    unreadCount: doc.unreadCount,
    closedAt: doc.closedAt,
    bot: doc.bot
      ? {
          paused: doc.bot.paused,
          pausedBy: doc.bot.pausedBy ?? null,
          pausedUntil: doc.bot.pausedUntil ?? null,
          session: doc.bot.session
            ? {
                chatbotId: doc.bot.session.chatbotId,
                nodeId: doc.bot.session.nodeId ?? null,
                vars: { ...(doc.bot.session.vars ?? {}) },
                attempts: doc.bot.session.attempts ?? 0,
                updatedAt: doc.bot.session.updatedAt,
                nudgeAt: doc.bot.session.nudgeAt ?? null,
              }
            : null,
        }
      : null,
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
    contacts: doc.contacts ?? [],
    event: doc.event
      ? {
          kind: doc.event.kind as ConversationEventKind,
          by: doc.event.by,
          from: doc.event.from,
          to: doc.event.to,
          // Only the events of a chatbot's tags carry them.
          ...(doc.event.tags && { tags: doc.event.tags }),
          ...(doc.event.pause && {
            pause: { until: doc.event.pause.until ?? null },
          }),
          ...(doc.event.funnel && {
            funnel: {
              name: doc.event.funnel.name,
              from: doc.event.funnel.from ?? null,
              to: doc.event.funnel.to,
            },
          }),
        }
      : null,
    interactive: doc.interactive ?? null,
    reply: doc.reply ?? null,
    waMessageId: doc.waMessageId,
    status: doc.status as MessageStatus,
    error: doc.error,
    sentBy: doc.sentBy
      ? {
          userId: doc.sentBy.userId,
          name: doc.sentBy.name,
          ...(doc.sentBy.kind && { kind: doc.sentBy.kind }),
        }
      : null,
    clientId: doc.clientId ?? null,
    createdAt: doc.createdAt,
  };
}

/** Conversations a member may see (see canSee in inbox-rules). */
function scopeFilter(scope: InboxScope): ConversationFilter | null {
  if (scope.viewAll) return null;
  return {
    lineId: { $in: [...scope.lineIds] },
    $or: [{ 'assignee.membershipId': scope.membershipId }, { assignee: null }],
  };
}

/**
 * Newest activity first (or oldest first); the cursor is
 * "<lastActivityAt ms>_<id>" of the last row of the previous page.
 */
function activityCursor(
  cursor: string | undefined,
  sort: 'recent' | 'oldest',
): ConversationFilter | null {
  const [ms, id] = cursor?.split('_') ?? [];
  const at = Number(ms);
  if (!id || !Number.isFinite(at) || !isValidObjectId(id)) return null;
  const date = new Date(at);
  const after = sort === 'oldest' ? '$gt' : '$lt';
  return {
    $or: [
      { lastActivityAt: { [after]: date } },
      { lastActivityAt: date, _id: { [after]: new Types.ObjectId(id) } },
    ],
  };
}

/** Assigned to some of these memberships; 'none' stands for unassigned. */
function assigneeFilter(ids: string[] | undefined): ConversationFilter | null {
  if (!ids?.length) return null;
  const members = ids.filter((id) => id !== 'none');
  return {
    $or: [
      ...(members.length > 0
        ? [{ 'assignee.membershipId': { $in: members } }]
        : []),
      ...(ids.includes('none') ? [{ assignee: null }] : []),
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
    await this.dropOpenOnlyIndex();
    try {
      await this.conversations.createIndexes();
    } catch (error: unknown) {
      if (!isDuplicateKey(error)) throw error;
      throw new Error(
        'Some contacts have several conversations on the same line. Merge them with `npm run inbox:merge-conversations` and restart.',
      );
    }
    await this.messages.createIndexes();
  }

  /** The unique index used to cover only OPEN conversations (before chats were reopened). */
  private async dropOpenOnlyIndex(): Promise<void> {
    const indexes = await this.conversations.collection
      .indexes()
      .catch(() => []);
    const old = indexes.find(
      (index) =>
        index.name === ONE_CONVERSATION_INDEX && index.partialFilterExpression,
    );
    if (old)
      await this.conversations.collection.dropIndex(ONE_CONVERSATION_INDEX);
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
      assigneeFilter(query.assigneeIds),
      query.from || query.to
        ? {
            lastActivityAt: {
              ...(query.from && { $gte: query.from }),
              ...(query.to && { $lte: query.to }),
            },
          }
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
      activityCursor(query.cursor, query.sort ?? 'recent'),
    ].filter(
      (condition): condition is ConversationFilter => condition !== null,
    );

    const rows = await this.conversations
      .find({
        workspaceId,
        ...(query.status !== 'ALL' && { status: query.status }),
        ...(query.lineId && { lineId: query.lineId }),
        ...(query.contactId && { contactId: query.contactId }),
        ...(query.contactIds && { contactId: { $in: query.contactIds } }),
        ...(conditions.length > 0 && { $and: conditions }),
      })
      .sort(
        query.sort === 'oldest'
          ? { lastActivityAt: 1, _id: 1 }
          : { lastActivityAt: -1, _id: -1 },
      )
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
    const active = {
      workspaceId,
      status: { $in: ['OPEN', 'ON_HOLD'] as ConversationStatus[] },
    };
    // Mine, but only on the lines the member still attends.
    const mineOnly = {
      ...visible,
      'assignee.membershipId': scope.membershipId,
    };
    const [
      mine,
      unassigned,
      all,
      unread,
      onHold,
      closed,
      mineOnHold,
      mineClosed,
      closedUnread,
      mineClosedUnread,
    ] = await Promise.all([
      this.conversations.countDocuments({ ...open, ...mineOnly }),
      this.conversations.countDocuments({
        ...open,
        $and: [visible, { assignee: null }],
      }),
      this.conversations.countDocuments({ ...open, ...visible }),
      this.conversations.aggregate<{ total: number }>([
        { $match: { ...active, ...visible } },
        { $group: { _id: null, total: { $sum: '$unreadCount' } } },
      ]),
      this.conversations.countDocuments({
        workspaceId,
        status: 'ON_HOLD',
        ...visible,
      }),
      this.conversations.countDocuments({
        workspaceId,
        status: 'CLOSED',
        ...visible,
      }),
      this.conversations.countDocuments({
        workspaceId,
        status: 'ON_HOLD',
        ...mineOnly,
      }),
      this.conversations.countDocuments({
        workspaceId,
        status: 'CLOSED',
        ...mineOnly,
      }),
      // Closed with messages nobody read (a chatbot closed them).
      this.conversations.countDocuments({
        workspaceId,
        status: 'CLOSED',
        unreadCount: { $gt: 0 },
        ...visible,
      }),
      this.conversations.countDocuments({
        workspaceId,
        status: 'CLOSED',
        unreadCount: { $gt: 0 },
        ...mineOnly,
      }),
    ]);
    return {
      mine,
      mineOnHold,
      mineClosed,
      unassigned,
      all,
      onHold,
      closed,
      closedUnread,
      mineClosedUnread,
      unread: unread[0]?.total ?? 0,
    };
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
  ): Promise<{
    conversation: ConversationRecord;
    created: boolean;
    reopened: boolean;
  }> {
    const filter = {
      workspaceId,
      lineId: input.lineId,
      contactId: input.contactId,
    };
    // A closed chat comes back to life, unassigned, for whoever takes it.
    // Its chatbot answers again from the start, unless it is off for this
    // contact (for 24 h or until someone turns it back on).
    const reopen = (keepPause: boolean) =>
      this.conversations
        .findOneAndUpdate(
          {
            ...filter,
            status: 'CLOSED',
            ...(keepPause && { 'bot.paused': true }),
          },
          {
            $set: {
              status: 'OPEN',
              closedAt: null,
              assignee: null,
              contact: input.contact,
              ...(keepPause ? { 'bot.session': null } : { bot: null }),
            },
          },
          { returnDocument: 'after' },
        )
        .lean<ConversationDocument>();
    const reopened = (await reopen(true)) ?? (await reopen(false));
    if (reopened) {
      return {
        conversation: toConversation(reopened),
        created: false,
        reopened: true,
      };
    }
    try {
      const result = await this.conversations
        .findOneAndUpdate(
          filter,
          {
            // The other fields come from the filter on insert.
            $setOnInsert: {
              status: 'OPEN',
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
        reopened: false,
      };
    } catch (error: unknown) {
      // Two messages of a new contact arrived at once: the other one created it.
      if (!isDuplicateKey(error)) throw error;
      const doc = await this.conversations
        .findOne(filter)
        .lean<ConversationDocument>();
      if (!doc) throw error;
      return {
        conversation: toConversation(doc),
        created: false,
        reopened: false,
      };
    }
  }

  async recordActivity(
    workspaceId: string,
    conversationId: string,
    activity: {
      lastMessage: LastMessage;
      inbound: boolean;
      keepUnread?: boolean;
    },
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const { lastMessage, inbound, keepUnread } = activity;
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
              // Replying means the agent read the conversation; a chatbot's
              // reply does not.
              $set: {
                lastMessage,
                lastActivityAt: lastMessage.at,
                ...(!keepUnread && { unreadCount: 0 }),
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
    options: { keepUnread?: boolean } = {},
  ): Promise<ConversationRecord | 'already_open' | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    try {
      const doc = await this.conversations
        .findOneAndUpdate(
          { workspaceId, _id },
          status === 'CLOSED'
            ? {
                $set: {
                  status,
                  closedAt: at,
                  ...(!options.keepUnread && { unreadCount: 0 }),
                },
              }
            : status === 'ON_HOLD'
              ? { $set: { status, closedAt: null } }
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

  async setBot(
    workspaceId: string,
    conversationId: string,
    bot: ConversationBot | null,
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const doc = await this.conversations
      .findOneAndUpdate(
        { workspaceId, _id },
        { $set: { bot } },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
  }

  async setBotSession(
    workspaceId: string,
    conversationId: string,
    session: BotSession | null,
    now: Date,
  ): Promise<void> {
    const _id = objectId(conversationId);
    if (!_id) return;
    await this.conversations.updateOne(
      {
        workspaceId,
        _id,
        // Not when an agent turned it off meanwhile (an ended 24 h pause is over).
        $or: [
          { 'bot.paused': { $ne: true } },
          { 'bot.pausedUntil': { $lte: now } },
        ],
      },
      {
        $set: {
          bot: { paused: false, pausedBy: null, pausedUntil: null, session },
        },
      },
    );
  }

  async claimBotNudges(
    workspaceId: string,
    now: Date,
    limit: number,
  ): Promise<ConversationRecord[]> {
    const claimed: ConversationRecord[] = [];
    while (claimed.length < limit) {
      const doc = await this.conversations
        .findOneAndUpdate(
          { workspaceId, 'bot.session.nudgeAt': { $lte: now } },
          { $set: { 'bot.session.nudgeAt': null } },
          { returnDocument: 'after' },
        )
        .lean<ConversationDocument>();
      if (!doc) break;
      claimed.push(toConversation(doc));
    }
    return claimed;
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

  async contactConversations(
    workspaceId: string,
    contactId: string,
    limit: number,
  ): Promise<ConversationRecord[]> {
    const rows = await this.conversations
      .find({ workspaceId, contactId })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(limit)
      .lean<ConversationDocument[]>();
    return rows.map(toConversation);
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

  async setLastMessageStatus(
    workspaceId: string,
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ): Promise<ConversationRecord | null> {
    const _id = objectId(conversationId);
    if (!_id) return null;
    const doc = await this.conversations
      .findOneAndUpdate(
        { workspaceId, _id, 'lastMessage.messageId': messageId },
        { $set: { 'lastMessage.status': status } },
        { returnDocument: 'after' },
      )
      .lean<ConversationDocument>();
    return doc ? toConversation(doc) : null;
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
