import { Schema, type Types } from 'mongoose';
import { workspaceScoped } from '../../../database/mongodb/workspace-scoped.plugin';

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
  'closed',
  'reopened',
  'contact_blocked',
  'contact_unblocked',
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
  status: 'OPEN' | 'CLOSED';
  assignee: { membershipId: string; userId: string; name: string } | null;
  lastMessage: {
    text: string | null;
    type: string;
    direction: 'IN' | 'OUT' | 'NOTE' | 'EVENT';
    at: Date;
  } | null;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  unreadCount: number;
  closedAt: Date | null;
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
  event?: {
    kind: string;
    by: { userId: string; name: string } | null;
    from: PartyDocument | null;
    to: PartyDocument | null;
  } | null;
  waMessageId: string | null;
  status: string;
  error: string | null;
  sentBy: { userId: string; name: string } | null;
  createdAt: Date;
}

const PersonSchema = () =>
  new Schema(
    {
      userId: { type: String, required: true },
      name: { type: String, required: true },
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
    status: { type: String, enum: ['OPEN', 'CLOSED'], required: true },
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
        },
        { _id: false },
      ),
      default: null,
    },
    lastActivityAt: { type: Date, required: true },
    lastInboundAt: { type: Date, default: null },
    unreadCount: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date, default: null },
  },
  { collection: 'conversations', timestamps: true, versionKey: false },
);
ConversationSchema.plugin(workspaceScoped);
// One open conversation per contact and line.
ConversationSchema.index(
  { workspaceId: 1, lineId: 1, contactId: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } },
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
    event: {
      type: new Schema(
        {
          kind: { type: String, enum: EVENT_KINDS, required: true },
          by: { type: PersonSchema(), default: null },
          from: { type: PartySchema(), default: null },
          to: { type: PartySchema(), default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    waMessageId: { type: String, default: null },
    status: { type: String, required: true },
    error: { type: String, default: null },
    sentBy: {
      type: new Schema(
        {
          userId: { type: String, required: true },
          name: { type: String, required: true },
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
