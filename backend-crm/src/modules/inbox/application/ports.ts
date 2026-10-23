import type { CursorPage } from '../../../database/mongodb/pagination';
import type {
  InteractiveContent,
  InteractiveReply,
} from '../../channels/domain/interactive';
import type {
  LocationInfo,
  MediaInfo,
  MessageType,
  SharedContact,
} from '../../channels/domain/whatsapp-payload';
import type { InboxScope, OutboundStatus } from '../domain/inbox-rules';

/** OPEN: being attended. ON_HOLD: "En espera", set by an agent. CLOSED: finished. */
export type ConversationStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED';
/** EVENT: a movement of the conversation (assignment, close…) shown in the chat. */
export type MessageDirection = 'IN' | 'OUT' | 'NOTE' | 'EVENT';
export type MessageStatus = OutboundStatus | 'received';

export type ConversationEventKind =
  | 'auto_assigned'
  | 'assigned'
  | 'transferred'
  | 'unassigned'
  | 'taken'
  /** Assigned to whoever replied to an unassigned conversation. */
  | 'claimed'
  | 'on_hold'
  | 'closed'
  /** By an agent, or by the customer writing again to a closed chat (by: null). */
  | 'reopened'
  | 'contact_blocked'
  | 'contact_unblocked'
  /** An agent turned the line's chatbot off (or back on) for this chat. */
  | 'bot_paused'
  | 'bot_resumed'
  /** The chatbot handed the chat to an agent (to) or to the unassigned queue. */
  | 'bot_transferred';

/** Who did it (null: the system) and the assignees before and after. */
export interface ConversationEvent {
  kind: ConversationEventKind;
  by: { userId: string; name: string } | null;
  from: { membershipId: string; name: string } | null;
  to: { membershipId: string; name: string } | null;
}

/** Media of a message: Meta's id plus our stored copy (GridFS), once downloaded. */
export interface MessageMedia extends MediaInfo {
  fileId?: string | null;
  size?: number | null;
}

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
  /** The message itself, to follow its delivery status in the list (✓✓). */
  messageId?: string | null;
  status?: MessageStatus | null;
}

/** Where a chatbot is in its flow for one conversation. */
export interface BotSession {
  chatbotId: string;
  /** The node waiting for the customer's answer (buttons, list, question). */
  nodeId: string;
  /** Answers saved by "Guardar respuesta" nodes. */
  vars: Record<string, string>;
  /** Answers that matched no option in a row. */
  attempts: number;
  updatedAt: Date;
}

/** The chatbot in one conversation: paused by an agent, or its progress. */
export interface ConversationBot {
  paused: boolean;
  pausedBy: { userId: string; name: string } | null;
  session: BotSession | null;
}

/** Who sent an outgoing message: an agent, or a chatbot (userId "bot:<id>"). */
export interface MessageSender {
  userId: string;
  name: string;
  kind?: 'user' | 'bot';
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
  /** Null: the chatbot (if the line has one) answers from the start. */
  bot: ConversationBot | null;
  createdAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  media: MessageMedia | null;
  location: LocationInfo | null;
  /** Shared contact cards (type "contacts"). */
  contacts: SharedContact[];
  event: ConversationEvent | null;
  /** Buttons, list or link button sent by a chatbot (type "interactive"). */
  interactive: InteractiveContent | null;
  /** The option the customer tapped (incoming answers to buttons or lists). */
  reply: InteractiveReply | null;
  waMessageId: string | null;
  status: MessageStatus;
  error: string | null;
  sentBy: MessageSender | null;
  /** Id the sending browser gave the message, to match its own bubble. */
  clientId: string | null;
  createdAt: Date;
}

export type InboxView = 'mine' | 'unassigned' | 'all';

export interface ConversationQuery {
  scope: InboxScope;
  view: InboxView;
  status: ConversationStatus | 'ALL';
  lineId?: string;
  contactId?: string;
  /** Part of the contact name or phone. */
  search?: string;
  /** Only these contacts (resolved from tag filters). */
  contactIds?: string[];
  /** Assigned to these memberships; 'none' = unassigned. */
  assigneeIds?: string[];
  /** Last activity within [from, to]. */
  from?: Date;
  to?: Date;
  /** recent (default): newest activity first; oldest: the other way round. */
  sort?: 'recent' | 'oldest';
  cursor?: string;
  limit: number;
}

export interface InboxCounts {
  /** Open conversations assigned to me. */
  mine: number;
  /** On hold and assigned to me. */
  mineOnHold: number;
  /** Closed and assigned to me. */
  mineClosed: number;
  /** Open, unassigned and visible to me. */
  unassigned: number;
  /** Open and visible to me. */
  all: number;
  /** On hold and visible to me. */
  onHold: number;
  /** Closed and visible to me. */
  closed: number;
  /** Unread messages in open or on-hold conversations visible to me. */
  unread: number;
}

export interface NewMessage {
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  media: MessageMedia | null;
  location?: LocationInfo | null;
  contacts?: SharedContact[];
  event?: ConversationEvent | null;
  interactive?: InteractiveContent | null;
  reply?: InteractiveReply | null;
  waMessageId: string | null;
  status: MessageStatus;
  sentBy: MessageSender | null;
  clientId?: string | null;
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
  /**
   * THE conversation of a contact on a line (one per contact and line),
   * created if needed. A closed one is reopened unassigned; one on hold
   * stays on hold.
   */
  abstract openConversation(
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
  }>;
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
  /**
   * The delivery status of the conversation's last message changed: the
   * list shows it (✓✓). Null when that message is no longer the last one.
   */
  abstract setLastMessageStatus(
    workspaceId: string,
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ): Promise<ConversationRecord | null>;
  abstract updateMessage(
    workspaceId: string,
    messageId: string,
    changes: {
      status: MessageStatus;
      waMessageId?: string;
      error?: string | null;
      /** Meta's id of an uploaded media file. */
      mediaId?: string;
    },
  ): Promise<MessageRecord | null>;
  abstract findMessage(
    workspaceId: string,
    messageId: string,
  ): Promise<MessageRecord | null>;
  /** Our stored copy of the message media. */
  abstract setMediaFile(
    workspaceId: string,
    messageId: string,
    file: { fileId: string; size: number; mimeType: string },
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
  /** Most recent conversations of a contact, newest first. */
  abstract contactConversations(
    workspaceId: string,
    contactId: string,
    limit: number,
  ): Promise<ConversationRecord[]>;
  /** At least one unread message, so it shows as pending again. */
  abstract markUnread(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null>;
  /** The chatbot state of the conversation (null: fresh). */
  abstract setBot(
    workspaceId: string,
    conversationId: string,
    bot: ConversationBot | null,
  ): Promise<ConversationRecord | null>;
  /** Where the chatbot is in its flow, unless an agent paused it meanwhile. */
  abstract setBotSession(
    workspaceId: string,
    conversationId: string,
    session: BotSession | null,
  ): Promise<void>;
}

/** Assignment data that lives in PostgreSQL (lines, agents, memberships). */
/** Lines an assignable member attends, and whether their role sees every chat. */
export interface MemberReach extends Assignee {
  lineIds: string[];
  viewAll: boolean;
}

export abstract class AssignmentStore {
  abstract activeMembers(workspaceId: string): Promise<Assignee[]>;
  /** Active members with the lines they attend (for transfers). */
  abstract membersReach(workspaceId: string): Promise<MemberReach[]>;
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
  /** Name of each line and the name of its enabled chatbot (null: none). */
  abstract lineInfo(workspaceId: string): Promise<Map<string, LineInfo>>;
  /** The chatbot of a line, or null when it has none. */
  abstract lineBot(lineId: string): Promise<LineBot | null>;
}

export interface LineInfo {
  name: string;
  /** Its enabled chatbot (it may still be outside its hours). */
  chatbot: string | null;
}

export interface LineBot {
  id: string;
  name: string;
  enabled: boolean;
  schedule: unknown;
}
