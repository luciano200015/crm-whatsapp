import type { CursorPage } from '../../../database/mongodb/pagination';
import type {
  MediaInfo,
  MessageType,
} from '../../channels/domain/whatsapp-payload';
import type { InboxScope, OutboundStatus } from '../domain/inbox-rules';

export type ConversationStatus = 'OPEN' | 'CLOSED';
export type MessageDirection = 'IN' | 'OUT' | 'NOTE';
export type MessageStatus = OutboundStatus | 'received';

/** Who a conversation is assigned to (a membership of the workspace). */
export interface Assignee {
  membershipId: string;
  userId: string;
  name: string;
}

export interface LastMessage {
  text: string | null;
  type: MessageType;
  direction: MessageDirection;
  at: Date;
}

export interface ConversationRecord {
  id: string;
  workspaceId: string;
  lineId: string;
  contactId: string;
  /** Copy of the contact at the time, so deleted contacts still read well. */
  contact: { name: string | null; phone: string };
  status: ConversationStatus;
  assignee: Assignee | null;
  lastMessage: LastMessage | null;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  unreadCount: number;
  closedAt: Date | null;
  createdAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  media: MediaInfo | null;
  waMessageId: string | null;
  status: MessageStatus;
  error: string | null;
  sentBy: { userId: string; name: string } | null;
  createdAt: Date;
}

export type InboxView = 'mine' | 'unassigned' | 'all';

export interface ConversationQuery {
  scope: InboxScope;
  view: InboxView;
  status: ConversationStatus;
  lineId?: string;
  contactId?: string;
  /** Part of the contact name or phone. */
  search?: string;
  cursor?: string;
  limit: number;
}

export interface InboxCounts {
  /** Open conversations assigned to me. */
  mine: number;
  /** Open, unassigned and visible to me. */
  unassigned: number;
  /** Open and visible to me. */
  all: number;
  /** Unread messages in open conversations visible to me. */
  unread: number;
}

export interface NewMessage {
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  media: MediaInfo | null;
  waMessageId: string | null;
  status: MessageStatus;
  sentBy: { userId: string; name: string } | null;
  createdAt: Date;
}

/** Conversations and messages (MongoDB). Every method is workspace-scoped. */
export abstract class InboxStore {
  abstract listConversations(
    workspaceId: string,
    query: ConversationQuery,
  ): Promise<CursorPage<ConversationRecord>>;
  abstract counts(workspaceId: string, scope: InboxScope): Promise<InboxCounts>;
  abstract findConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null>;
  /** The open conversation of a contact on a line, created if needed. */
  abstract openConversation(
    workspaceId: string,
    input: {
      lineId: string;
      contactId: string;
      contact: { name: string | null; phone: string };
      at: Date;
    },
  ): Promise<{ conversation: ConversationRecord; created: boolean }>;
  /** 'duplicate' when a message with this waMessageId already exists. */
  abstract insertMessage(
    workspaceId: string,
    message: NewMessage,
  ): Promise<MessageRecord | 'duplicate'>;
  abstract listMessages(
    workspaceId: string,
    conversationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<MessageRecord>>;
  /** Updates the preview, ordering and counters after a message. */
  abstract recordActivity(
    workspaceId: string,
    conversationId: string,
    activity: { lastMessage: LastMessage; inbound: boolean },
  ): Promise<ConversationRecord | null>;
  abstract updateMessage(
    workspaceId: string,
    messageId: string,
    changes: {
      status: MessageStatus;
      waMessageId?: string;
      error?: string | null;
    },
  ): Promise<MessageRecord | null>;
  abstract findMessageByWaId(
    workspaceId: string,
    waMessageId: string,
  ): Promise<MessageRecord | null>;
  /**
   * Sets the assignee. With `onlyIfUnassigned`, does nothing (returns null)
   * when someone took the conversation first.
   */
  abstract setAssignee(
    workspaceId: string,
    conversationId: string,
    assignee: Assignee | null,
    options?: { onlyIfUnassigned?: boolean },
  ): Promise<ConversationRecord | null>;
  /** 'already_open' when reopening while the contact has another open conversation on the line. */
  abstract setStatus(
    workspaceId: string,
    conversationId: string,
    status: ConversationStatus,
    at: Date,
  ): Promise<ConversationRecord | 'already_open' | null>;
  abstract markRead(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null>;
}

/** Assignment data that lives in PostgreSQL (lines, agents, memberships). */
export abstract class AssignmentStore {
  abstract activeMembers(workspaceId: string): Promise<Assignee[]>;
  /** Next agent of the line in turns (locks the line row); null without agents. */
  abstract nextAgent(lineId: string): Promise<Assignee | null>;
  /** Lines the membership attends. */
  abstract agentLineIds(
    workspaceId: string,
    membershipId: string,
  ): Promise<string[]>;
  /** An active membership of the workspace, or null. */
  abstract activeMember(
    workspaceId: string,
    membershipId: string,
  ): Promise<Assignee | null>;
  abstract lineNames(workspaceId: string): Promise<Map<string, string>>;
}
