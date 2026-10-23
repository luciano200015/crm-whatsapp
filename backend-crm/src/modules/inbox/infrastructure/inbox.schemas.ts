import { Schema, type Types } from 'mongoose';
import { workspaceScoped } from '../../../database/mongodb/workspace-scoped.plugin';
import type { InteractiveContent } from '../../channels/domain/interactive';

export const CONVERSATION_MODEL = 'Conversation';
export const MESSAGE_MODEL = 'Message';

const MESSAGE_TYPES = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'unsupported',
];

const DIRECTIONS = ['IN', 'OUT', 'NOTE', 'EVENT'];
const EVENT_KINDS = [
  'auto_assigned',
  'assigned',
  'transferred',
  'unassigned',
  'taken',
  'claimed',
  'on_hold',
  'closed',
  'reopened',
  'contact_blocked',
  'contact_unblocked',
  'bot_paused',
  'bot_resumed',
  'bot_transferred',
  'bot_tagged',
];

interface PartyDocument {
  membershipId: string;
  name: string;
}

export interface ConversationDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  lineId: string;
  contactId: string;
  contact: { name: string | null; phone: string };
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  assignee: { membershipId: string; userId: string; name: string } | null;
  lastMessage: {
    text: string | null;
    type: string;
    direction: 'IN' | 'OUT' | 'NOTE' | 'EVENT';
    at: Date;
    messageId?: string | null;
    status?: string | null;
  } | null;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  unreadCount: number;
  closedAt: Date | null;
  bot?: {
    paused: boolean;
    pausedBy: { userId: string; name: string } | null;
    pausedUntil?: Date | null;
    session: {
      chatbotId: string;
      nodeId: string | null;
      vars: Record<string, string>;
      attempts: number;
      updatedAt: Date;
      nudgeAt?: Date | null;
    } | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  conversationId: Types.ObjectId;
  direction: 'IN' | 'OUT' | 'NOTE' | 'EVENT';
  type: string;
  text: string | null;
  media: {
    id: string;
    mimeType: string | null;
    caption: string | null;
    filename: string | null;
    fileId?: string | null;
    size?: number | null;
  } | null;
  location?: {
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
  } | null;
  contacts?: {
    name: string;
    phones: { phone: string; waId: string | null; type: string | null }[];
    emails: string[];
    organization: string | null;
  }[];
  event?: {
    kind: string;
    by: { userId: string; name: string; kind?: 'user' | 'bot' } | null;
    from: PartyDocument | null;
    to: PartyDocument | null;
    tags?: { added: string[]; removed: string[] } | null;
    pause?: { until: Date | null } | null;
  } | null;
  interactive?: InteractiveContent | null;
  reply?: { id: string; title: string } | null;
  waMessageId: string | null;
  status: string;
  error: string | null;
  sentBy: { userId: string; name: string; kind?: 'user' | 'bot' } | null;
  clientId?: string | null;
  createdAt: Date;
}

const PersonSchema = () =>
  new Schema(
    {
      userId: { type: String, required: true },
      name: { type: String, required: true },
      kind: { type: String, enum: ['user', 'bot'], default: undefined },
    },
    { _id: false },
  );
const PartySchema = () =>
  new Schema(
    {
      membershipId: { type: String, required: true },
      name: { type: String, required: true },
    },
    { _id: false },
  );

export const ConversationSchema = new Schema<ConversationDocument>(
  {
    lineId: { type: String, required: true },
    contactId: { type: String, required: true },
    contact: {
      _id: false,
      name: { type: String, default: null },
      phone: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ['OPEN', 'ON_HOLD', 'CLOSED'],
      required: true,
    },
    assignee: {
      type: new Schema(
        {
          membershipId: { type: String, required: true },
          userId: { type: String, required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    lastMessage: {
      type: new Schema(
        {
          text: { type: String, default: null },
          type: { type: String, enum: MESSAGE_TYPES, required: true },
          direction: { type: String, enum: DIRECTIONS, required: true },
          at: { type: Date, required: true },
          messageId: { type: String, default: null },
          status: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    lastActivityAt: { type: Date, required: true },
    lastInboundAt: { type: Date, default: null },
    unreadCount: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date, default: null },
    // Chatbot of the line in this chat: paused by an agent, or where it is in its flow.
    bot: {
      type: new Schema(
        {
          paused: { type: Boolean, default: false },
          pausedBy: { type: PersonSchema(), default: null },
          // A 24 h pause ends alone; null with paused: until turned on.
          pausedUntil: { type: Date, default: null },
          session: {
            type: new Schema(
              {
                chatbotId: { type: String, required: true },
                // null: the flow ended but the conversation is still active.
                nodeId: { type: String, default: null },
                vars: { type: Schema.Types.Mixed, default: {} },
                attempts: { type: Number, default: 0 },
                updatedAt: { type: Date, required: true },
                // When the inactivity message is due.
                nudgeAt: { type: Date, default: null },
              },
              { _id: false, minimize: false },
            ),
            default: null,
          },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { collection: 'conversations', timestamps: true, versionKey: false },
);
ConversationSchema.plugin(workspaceScoped);
// One conversation per contact and line: it is reopened, never duplicated.
export const ONE_CONVERSATION_INDEX = 'workspaceId_1_lineId_1_contactId_1';
ConversationSchema.index(
  { workspaceId: 1, lineId: 1, contactId: 1 },
  { unique: true, name: ONE_CONVERSATION_INDEX },
);
// Chatbot inactivity messages that are due (only chats waiting for one).
ConversationSchema.index(
  { workspaceId: 1, 'bot.session.nudgeAt': 1 },
  { partialFilterExpression: { 'bot.session.nudgeAt': { $type: 'date' } } },
);
ConversationSchema.index({
  workspaceId: 1,
  status: 1,
  lastActivityAt: -1,
  _id: -1,
});
ConversationSchema.index({
  workspaceId: 1,
  'assignee.membershipId': 1,
  status: 1,
  lastActivityAt: -1,
});
ConversationSchema.index({
  workspaceId: 1,
  lineId: 1,
  status: 1,
  lastActivityAt: -1,
});

export const MessageSchema = new Schema<MessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    direction: { type: String, enum: DIRECTIONS, required: true },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    text: { type: String, default: null },
    media: {
      type: new Schema(
        {
          id: { type: String, required: true },
          mimeType: { type: String, default: null },
          caption: { type: String, default: null },
          filename: { type: String, default: null },
          // GridFS copy, once downloaded from Meta (or uploaded by an agent).
          fileId: { type: String, default: null },
          size: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    location: {
      type: new Schema(
        {
          latitude: { type: Number, required: true },
          longitude: { type: Number, required: true },
          name: { type: String, default: null },
          address: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    contacts: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            phones: {
              type: [
                new Schema(
                  {
                    phone: { type: String, required: true },
                    waId: { type: String, default: null },
                    type: { type: String, default: null },
                  },
                  { _id: false },
                ),
              ],
              default: [],
            },
            emails: { type: [String], default: [] },
            organization: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    event: {
      type: new Schema(
        {
          kind: { type: String, enum: EVENT_KINDS, required: true },
          by: { type: PersonSchema(), default: null },
          from: { type: PartySchema(), default: null },
          to: { type: PartySchema(), default: null },
          tags: {
            type: new Schema(
              {
                added: { type: [String], default: [] },
                removed: { type: [String], default: [] },
              },
              { _id: false },
            ),
            default: undefined,
          },
          pause: {
            type: new Schema(
              { until: { type: Date, default: null } },
              { _id: false },
            ),
            default: undefined,
          },
        },
        { _id: false },
      ),
      default: null,
    },
    // Buttons, list or link button of a chatbot, as sent to WhatsApp.
    interactive: { type: Schema.Types.Mixed, default: null },
    // The option a customer tapped (its id and title).
    reply: {
      type: new Schema(
        {
          id: { type: String, required: true },
          title: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: null,
    },
    waMessageId: { type: String, default: null },
    status: { type: String, required: true },
    error: { type: String, default: null },
    clientId: { type: String, default: null },
    sentBy: {
      type: new Schema(
        {
          // "bot:<chatbot id>" for messages of a chatbot.
          userId: { type: String, required: true },
          name: { type: String, required: true },
          kind: { type: String, enum: ['user', 'bot'], default: undefined },
        },
        { _id: false },
      ),
      default: null,
    },
    createdAt: { type: Date, required: true },
  },
  { collection: 'messages', versionKey: false },
);
MessageSchema.plugin(workspaceScoped);
MessageSchema.index({ workspaceId: 1, conversationId: 1, _id: -1 });
// Meta may deliver a webhook more than once: the message id makes it idempotent.
MessageSchema.index(
  { workspaceId: 1, waMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { waMessageId: { $type: 'string' } },
  },
);
