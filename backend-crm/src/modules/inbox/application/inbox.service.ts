import { Injectable } from '@nestjs/common';
import type { CursorPage } from '../../../database/mongodb/pagination';
import {
  planLimit,
  WorkspaceEntitlements,
} from '../../../shared/entitlements/workspace-entitlements';
import { Clock } from '../../../shared/time/clock';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import { ChannelsService } from '../../channels/application/channels.service';
import {
  ChannelsStore,
  WhatsAppApiError,
  WhatsAppGateway,
  type LineCredentials,
} from '../../channels/application/ports';
import type {
  MessageType,
  SharedContact,
} from '../../channels/domain/whatsapp-payload';
import { ContactsStore } from '../../contacts/application/ports';
import { ContactsErrors } from '../../contacts/application/contacts-errors';
import { normalizePhone, toWhatsAppId } from '../../contacts/domain/phone';
import {
  canSee,
  isWindowOpen,
  startOfMonth,
  windowExpiresAt,
  type InboxScope,
} from '../domain/inbox-rules';
import { InboxErrors } from './inbox-errors';
import { ContactQuota } from './contact-quota';
import { ConversationTimeline } from './conversation-timeline';
import {
  baseMimeType,
  MediaStore,
  outgoingMedia,
  sanitizeFilename,
} from './media';
import { InboxEvents } from './inbox-events';
import {
  AssignmentStore,
  InboxStore,
  type Assignee,
  type ConversationRecord,
  type ConversationStatus,
  type InboxCounts,
  type InboxView,
  type MessageMedia,
  type MessageRecord,
} from './ports';

export interface ConversationView extends Omit<
  ConversationRecord,
  'workspaceId'
> {
  /** Null when the line was deleted. */
  lineName: string | null;
  /** WhatsApp's 24 h customer-service window. */
  windowOpen: boolean;
  windowExpiresAt: Date | null;
}

export type MessageView = Omit<MessageRecord, 'waMessageId' | 'media'> & {
  media: {
    /** The message id: GET …/messages/:id/media streams the file. */
    id: string;
    mimeType: string | null;
    caption: string | null;
    filename: string | null;
    size: number | null;
  } | null;
};

export interface ConversationListQuery {
  view: InboxView;
  status: ConversationStatus | 'ALL';
  lineId?: string;
  contactId?: string;
  search?: string;
  cursor?: string;
  limit: number;
}

/** The member acting in the inbox (resolved by WorkspaceAccessGuard). */
export interface InboxActor {
  userId: string;
  access: WorkspaceAccess;
}

/**
 * The inbox of a workspace: conversations visible to each member, replies
 * through the line's WhatsApp number, notes, assignment, close/reopen.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly store: InboxStore,
    private readonly assignments: AssignmentStore,
    private readonly lines: ChannelsStore,
    private readonly channels: ChannelsService,
    private readonly whatsapp: WhatsAppGateway,
    private readonly contacts: ContactsStore,
    private readonly entitlements: WorkspaceEntitlements,
    private readonly events: InboxEvents,
    private readonly clock: Clock,
    private readonly contactQuota: ContactQuota,
    private readonly timeline: ConversationTimeline,
    private readonly mediaStore: MediaStore,
  ) {}

  async scope(actor: InboxActor): Promise<InboxScope> {
    const { workspaceId, membershipId, permissions } = actor.access;
    return {
      membershipId,
      viewAll: permissions.has('conversations.view_all'),
      lineIds: await this.assignments.agentLineIds(workspaceId, membershipId),
    };
  }

  async options(actor: InboxActor) {
    const scope = await this.scope(actor);
    const names = await this.assignments.lineNames(actor.access.workspaceId);
    return {
      lines: [...names]
        .filter(([id]) => scope.viewAll || scope.lineIds.includes(id))
        .map(([id, name]) => ({ id, name })),
      members: actor.access.permissions.has('conversations.assign')
        ? await this.assignments.activeMembers(actor.access.workspaceId)
        : [],
    };
  }

  async autoAssignmentOptions(workspaceId: string) {
    const [lines, members] = await Promise.all([
      this.lines.listLines(workspaceId),
      this.assignments.activeMembers(workspaceId),
    ]);
    return {
      lines: lines.map((line) => ({
        id: line.id,
        name: line.name,
        status: line.status,
        autoAssign: line.autoAssign,
        membershipIds: line.agents.map((agent) => agent.membershipId),
      })),
      members,
    };
  }

  async list(
    actor: InboxActor,
    query: ConversationListQuery,
  ): Promise<CursorPage<ConversationView>> {
    const { workspaceId } = actor.access;
    const scope = await this.scope(actor);
    const [page, names] = await Promise.all([
      this.store.listConversations(workspaceId, { ...query, scope }),
      this.assignments.lineNames(workspaceId),
    ]);
    return {
      items: page.items.map((c) => this.toView(c, names)),
      nextCursor: page.nextCursor,
    };
  }

  async counts(actor: InboxActor): Promise<InboxCounts> {
    return this.store.counts(actor.access.workspaceId, await this.scope(actor));
  }

  async get(actor: InboxActor, conversationId: string) {
    return this.view(await this.requireVisible(actor, conversationId));
  }

  async messages(
    actor: InboxActor,
    conversationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<MessageView>> {
    await this.requireVisible(actor, conversationId);
    const page = await this.store.listMessages(
      actor.access.workspaceId,
      conversationId,
      cursor,
      limit,
    );
    return {
      items: page.items.map(toMessageView),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Sends a WhatsApp text. An unassigned conversation is assigned to whoever
   * replies. Delivery failures are stored on the message (status "failed")
   * instead of failing the request, so the agent sees what happened.
   */
  async reply(
    actor: InboxActor,
    conversationId: string,
    text: string,
  ): Promise<MessageView> {
    return this.deliver(actor, conversationId, {
      type: 'text',
      text,
      send: (credentials, to) => this.whatsapp.sendText(credentials, to, text),
    });
  }

  /**
   * Sends a file (image, video, audio or document) with the same rules as a
   * reply. It is stored first, so the chat shows it even if Meta refuses it.
   */
  async sendMedia(
    actor: InboxActor,
    conversationId: string,
    file: { buffer: Buffer; mimeType: string; filename: string; size: number },
    caption: string | null,
  ): Promise<MessageView> {
    const checked = outgoingMedia(file.mimeType, file.size);
    if ('error' in checked) {
      throw checked.error === 'too_large'
        ? InboxErrors.mediaTooLarge(checked.maxBytes)
        : InboxErrors.unsupportedMedia();
    }
    const { type } = checked;
    const mimeType = baseMimeType(file.mimeType);
    const filename = sanitizeFilename(file.filename) ?? `archivo.${type}`;
    const text = type === 'audio' ? null : caption;
    return this.deliver(actor, conversationId, {
      type,
      text,
      prepare: async (workspaceId) => {
        const stored = await this.mediaStore.put(workspaceId, {
          body: file.buffer,
          mimeType,
          filename,
        });
        return {
          // Replaced by Meta's id once uploaded.
          id: `local:${stored.fileId}`,
          mimeType,
          caption: text,
          filename,
          fileId: stored.fileId,
          size: stored.size,
        };
      },
      send: async (credentials, to) => {
        const { mediaId } = await this.whatsapp.uploadMedia(credentials, {
          body: file.buffer,
          mimeType,
          filename,
        });
        const sent = await this.whatsapp.sendMedia(credentials, to, {
          type,
          mediaId,
          caption: text,
          filename,
        });
        return { ...sent, mediaId };
      },
    });
  }

  /** Contact cards the customer can save or write to. */
  async sendContacts(
    actor: InboxActor,
    conversationId: string,
    contacts: { name: string; phone: string }[],
  ): Promise<MessageView> {
    const cards: SharedContact[] = contacts.map((contact) => {
      const phone = normalizePhone(contact.phone);
      if (!phone) throw ContactsErrors.invalidPhone();
      return {
        name: contact.name.trim(),
        phones: [{ phone, waId: toWhatsAppId(phone), type: 'CELL' }],
        emails: [],
        organization: null,
      };
    });
    return this.deliver(actor, conversationId, {
      type: 'contacts',
      text: cards.map((card) => card.name).join(', '),
      contacts: cards,
      send: (credentials, to) =>
        this.whatsapp.sendContacts(credentials, to, cards),
    });
  }

  /** Conversation the actor may see (for streaming its media). */
  async visible(
    actor: InboxActor,
    conversationId: string,
  ): Promise<ConversationRecord> {
    return this.requireVisible(actor, conversationId);
  }

  private async deliver(
    actor: InboxActor,
    conversationId: string,
    outgoing: {
      type: MessageType;
      text: string | null;
      contacts?: SharedContact[];
      /** Runs after every check, before the message is stored. */
      prepare?: (workspaceId: string) => Promise<MessageMedia>;
      send: (
        credentials: LineCredentials,
        to: string,
      ) => Promise<{ waMessageId: string; mediaId?: string }>;
    },
  ): Promise<MessageView> {
    const { workspaceId } = actor.access;
    let conversation = await this.requireVisible(actor, conversationId);
    // On hold still allows replying; closed must be reopened first.
    if (conversation.status === 'CLOSED')
      throw InboxErrors.conversationClosed();
    const line = await this.lines.findLine(workspaceId, conversation.lineId);
    if (!line || line.status === 'DISABLED')
      throw InboxErrors.lineUnavailable();
    const now = this.clock.now();
    if (!isWindowOpen(conversation.lastInboundAt, now)) {
      throw InboxErrors.windowClosed();
    }
    await this.assertContactLimit(workspaceId, conversation.contactId, now);

    const me = await this.me(actor);
    if (!conversation.assignee) {
      const claimed = await this.store.setAssignee(
        workspaceId,
        conversationId,
        me,
        {
          onlyIfUnassigned: true,
        },
      );
      if (!claimed) throw InboxErrors.alreadyAssigned();
      this.emitConversation(claimed, conversation);
      await this.timeline.assignment(claimed, null, me, 'claimed');
      conversation = claimed;
    }

    const media = outgoing.prepare ? await outgoing.prepare(workspaceId) : null;
    const pending = await this.store.insertMessage(workspaceId, {
      conversationId,
      direction: 'OUT',
      type: outgoing.type,
      text: outgoing.text,
      media,
      contacts: outgoing.contacts,
      waMessageId: null,
      status: 'pending',
      sentBy: { userId: me.userId, name: me.name },
      createdAt: now,
    });
    if (pending === 'duplicate')
      throw new Error('Unexpected duplicate message');

    let sent: MessageRecord | null;
    try {
      const result = await outgoing.send(
        await this.channels.credentials(line),
        toWhatsAppId(conversation.contact.phone),
      );
      sent = await this.store.updateMessage(workspaceId, pending.id, {
        status: 'sent',
        waMessageId: result.waMessageId,
        ...(result.mediaId && { mediaId: result.mediaId }),
      });
    } catch (error: unknown) {
      if (!(error instanceof WhatsAppApiError)) throw error;
      sent = await this.store.updateMessage(workspaceId, pending.id, {
        status: 'failed',
        error: error.message.slice(0, 500),
      });
    }
    const message = sent ?? pending;
    const updated =
      (await this.store.recordActivity(workspaceId, conversationId, {
        lastMessage: {
          text: outgoing.text,
          type: outgoing.type,
          direction: 'OUT',
          at: now,
        },
        inbound: false,
      })) ?? conversation;
    await this.contacts.touchLastMessage(
      workspaceId,
      conversation.contactId,
      now,
    );

    this.events.emit({
      workspaceId,
      type: 'message.created',
      conversation: updated,
      message,
    });
    return toMessageView(message);
  }

  /** Internal note: visible to the team, never sent to WhatsApp. */
  async note(
    actor: InboxActor,
    conversationId: string,
    text: string,
  ): Promise<MessageView> {
    const { workspaceId } = actor.access;
    const conversation = await this.requireVisible(actor, conversationId);
    const me = await this.me(actor);
    const note = await this.store.insertMessage(workspaceId, {
      conversationId,
      direction: 'NOTE',
      type: 'text',
      text,
      media: null,
      waMessageId: null,
      status: 'sent',
      sentBy: { userId: me.userId, name: me.name },
      createdAt: this.clock.now(),
    });
    if (note === 'duplicate') throw new Error('Unexpected duplicate note');
    this.events.emit({
      workspaceId,
      type: 'message.created',
      conversation,
      message: note,
    });
    return toMessageView(note);
  }

  /** conversations.assign: assign to any active member, or unassign (null). */
  async assign(
    actor: InboxActor,
    conversationId: string,
    membershipId: string | null,
  ): Promise<ConversationView> {
    const { workspaceId } = actor.access;
    const conversation = await this.requireVisible(actor, conversationId);
    const assignee = membershipId
      ? await this.assignments.activeMember(workspaceId, membershipId)
      : null;
    if (membershipId && !assignee) throw InboxErrors.memberNotFound();
    const updated = await this.store.setAssignee(
      workspaceId,
      conversationId,
      assignee,
    );
    if (!updated) throw InboxErrors.conversationNotFound();
    this.emitConversation(updated, conversation);
    await this.timeline.assignment(
      updated,
      conversation.assignee,
      await this.me(actor),
    );
    return this.view(updated);
  }

  /** "Tomar chat": assign an unassigned conversation to yourself. */
  async take(actor: InboxActor, conversationId: string) {
    const { workspaceId, membershipId } = actor.access;
    const conversation = await this.requireVisible(actor, conversationId);
    if (conversation.assignee?.membershipId === membershipId) {
      return this.view(conversation);
    }
    if (conversation.assignee) throw InboxErrors.alreadyAssigned();
    const me = await this.me(actor);
    const updated = await this.store.setAssignee(
      workspaceId,
      conversationId,
      me,
      { onlyIfUnassigned: true },
    );
    if (!updated) throw InboxErrors.alreadyAssigned();
    this.emitConversation(updated, conversation);
    await this.timeline.assignment(updated, null, me, 'taken');
    return this.view(updated);
  }

  async setStatus(
    actor: InboxActor,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<ConversationView> {
    const conversation = await this.requireVisible(actor, conversationId);
    if (conversation.status === status) return this.view(conversation);
    const updated = await this.store.setStatus(
      actor.access.workspaceId,
      conversationId,
      status,
      this.clock.now(),
    );
    if (updated === 'already_open') throw InboxErrors.alreadyOpen();
    if (!updated) throw InboxErrors.conversationNotFound();
    this.emitConversation(updated, conversation);
    const me = await this.me(actor);
    await this.timeline.record(updated, {
      kind:
        status === 'CLOSED'
          ? 'closed'
          : status === 'ON_HOLD'
            ? 'on_hold'
            : 'reopened',
      by: { userId: me.userId, name: me.name },
      from: null,
      to: null,
    });
    return this.view(updated);
  }

  async markRead(actor: InboxActor, conversationId: string) {
    await this.requireVisible(actor, conversationId);
    const updated = await this.store.markRead(
      actor.access.workspaceId,
      conversationId,
    );
    if (!updated) throw InboxErrors.conversationNotFound();
    this.emitConversation(updated, updated);
    return this.view(updated);
  }

  /** "Marcar como no leído": shows the conversation as pending again. */
  async markUnread(actor: InboxActor, conversationId: string) {
    await this.requireVisible(actor, conversationId);
    const updated = await this.store.markUnread(
      actor.access.workspaceId,
      conversationId,
    );
    if (!updated) throw InboxErrors.conversationNotFound();
    this.emitConversation(updated, updated);
    return this.view(updated);
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /** Conversations a member may not see are reported as missing. */
  private async requireVisible(
    actor: InboxActor,
    conversationId: string,
  ): Promise<ConversationRecord> {
    const conversation = await this.store.findConversation(
      actor.access.workspaceId,
      conversationId,
    );
    if (!conversation || !canSee(conversation, await this.scope(actor))) {
      throw InboxErrors.conversationNotFound();
    }
    return conversation;
  }

  private async me(actor: InboxActor): Promise<Assignee> {
    const me = await this.assignments.activeMember(
      actor.access.workspaceId,
      actor.access.membershipId,
    );
    if (!me) throw InboxErrors.memberNotFound();
    return me;
  }

  /**
   * Reserve a distinct contacted recipient for this UTC month. Incoming
   * traffic cannot consume or bypass the outgoing contact allowance.
   */
  private async assertContactLimit(
    workspaceId: string,
    contactId: string,
    now: Date,
  ): Promise<void> {
    const plan = await this.entitlements.entitlements(workspaceId);
    if (!plan?.hasFullAccess) throw InboxErrors.subscriptionInactive();
    const limit = plan ? planLimit(plan, 'limits.active_contacts') : null;
    const since = startOfMonth(now);
    if (
      !(await this.contactQuota.reserve(workspaceId, contactId, since, limit))
    ) {
      throw InboxErrors.contactLimitReached({
        plan: plan.planName,
        limit: limit ?? 0,
        usage: limit ?? 0,
      });
    }
  }

  private emitConversation(
    conversation: ConversationRecord,
    before: ConversationRecord,
  ): void {
    this.events.emit({
      workspaceId: conversation.workspaceId,
      type: 'conversation.updated',
      conversation,
      previousAssigneeId: before.assignee?.membershipId ?? null,
    });
  }

  private async view(conversation: ConversationRecord) {
    const names = await this.assignments.lineNames(conversation.workspaceId);
    return this.toView(conversation, names);
  }

  toView(
    conversation: ConversationRecord,
    lineNames: Map<string, string>,
  ): ConversationView {
    const { workspaceId: _workspaceId, ...rest } = conversation;
    return {
      ...rest,
      lineName: lineNames.get(conversation.lineId) ?? null,
      windowOpen: isWindowOpen(conversation.lastInboundAt, this.clock.now()),
      windowExpiresAt: windowExpiresAt(conversation.lastInboundAt),
    };
  }
}

export function toMessageView(message: MessageRecord): MessageView {
  const { waMessageId: _waMessageId, media, ...rest } = message;
  return {
    ...rest,
    // Ids of our storage and of Meta stay on the server.
    media: media && {
      id: message.id,
      mimeType: media.mimeType,
      caption: media.caption,
      filename: media.filename,
      size: media.size ?? null,
    },
  };
}
