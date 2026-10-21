import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/time/clock';
import { ChannelsService } from '../../channels/application/channels.service';
import {
  ChannelsStore,
  WhatsAppApiError,
  WhatsAppGateway,
} from '../../channels/application/ports';
import { ContactsErrors } from '../../contacts/application/contacts-errors';
import { ContactsStore } from '../../contacts/application/ports';
import { toWhatsAppId } from '../../contacts/domain/phone';
import { ConversationTimeline } from './conversation-timeline';
import { InboxErrors } from './inbox-errors';
import { InboxEvents } from './inbox-events';
import type { InboxActor } from './inbox.service';
import { AssignmentStore, InboxStore } from './ports';

/** Conversations whose lines are blocked on WhatsApp too. */
const RECENT_CONVERSATIONS = 50;

export interface LineBlockResult {
  lineId: string;
  lineName: string;
  /** False when WhatsApp refused it (e.g. the contact wrote more than 24 h ago). */
  ok: boolean;
  error: string | null;
}

export interface BlockResult {
  blocked: boolean;
  /** One entry per line the contact talked to. */
  whatsapp: LineBlockResult[];
}

/**
 * Blocking a contact: the CRM ignores their messages, their open chats are
 * closed with a notice, and the number is blocked on WhatsApp on every line
 * they wrote to (best effort: Meta has its own rules).
 */
@Injectable()
export class ContactBlockService {
  constructor(
    private readonly contacts: ContactsStore,
    private readonly store: InboxStore,
    private readonly assignments: AssignmentStore,
    private readonly lines: ChannelsStore,
    private readonly channels: ChannelsService,
    private readonly whatsapp: WhatsAppGateway,
    private readonly timeline: ConversationTimeline,
    private readonly events: InboxEvents,
    private readonly clock: Clock,
  ) {}

  async setBlocked(
    actor: InboxActor,
    contactId: string,
    blocked: boolean,
  ): Promise<BlockResult> {
    const { workspaceId, membershipId } = actor.access;
    const me = await this.assignments.activeMember(workspaceId, membershipId);
    if (!me) throw InboxErrors.memberNotFound();
    const by = { userId: me.userId, name: me.name };
    const now = this.clock.now();

    const contact = await this.contacts.setBlocked(
      workspaceId,
      contactId,
      blocked ? { at: now, by } : null,
    );
    if (!contact) throw ContactsErrors.contactNotFound();

    const conversations = await this.store.contactConversations(
      workspaceId,
      contactId,
      RECENT_CONVERSATIONS,
    );
    const open = conversations.filter((c) => c.status !== 'CLOSED');
    const kind = blocked ? 'contact_blocked' : 'contact_unblocked';
    if (blocked && open.length > 0) {
      for (const conversation of open) {
        const closed = await this.store.setStatus(
          workspaceId,
          conversation.id,
          'CLOSED',
          now,
        );
        if (!closed || closed === 'already_open') continue;
        this.events.emit({
          workspaceId,
          type: 'conversation.updated',
          conversation: closed,
          previousAssigneeId: conversation.assignee?.membershipId ?? null,
        });
        await this.timeline.record(closed, { kind, by, from: null, to: null });
      }
    } else if (conversations[0]) {
      // Leave the movement in the latest chat so the team sees it.
      await this.timeline.record(conversations[0], {
        kind,
        by,
        from: null,
        to: null,
      });
    }

    const lineIds = [...new Set(conversations.map((c) => c.lineId))];
    const whatsapp: LineBlockResult[] = [];
    for (const lineId of lineIds) {
      const line = await this.lines.findLine(workspaceId, lineId);
      if (!line || line.status === 'DISABLED') continue;
      try {
        await this.whatsapp.setUserBlocked(
          await this.channels.credentials(line),
          toWhatsAppId(contact.phone),
          blocked,
        );
        whatsapp.push({ lineId, lineName: line.name, ok: true, error: null });
      } catch (error: unknown) {
        if (!(error instanceof WhatsAppApiError)) throw error;
        whatsapp.push({
          lineId,
          lineName: line.name,
          ok: false,
          error: error.message.slice(0, 300),
        });
      }
    }
    return { blocked, whatsapp };
  }
}
