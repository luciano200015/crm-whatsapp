import { Injectable, Logger } from '@nestjs/common';
import {
  WhatsAppEventsSink,
  type LineRecord,
} from '../../channels/application/ports';
import type {
  InboundMessage,
  StatusUpdate,
  WebhookEvents,
} from '../../channels/domain/whatsapp-payload';
import { ContactsStore } from '../../contacts/application/ports';
import { normalizePhone } from '../../contacts/domain/phone';
import { withinSchedule, type Schedule } from '../../chatbots/domain/schedule';
import { nextStatus } from '../domain/inbox-rules';
import { ConversationTimeline } from './conversation-timeline';
import { InboxMediaService } from './inbox-media.service';
import { InboxEvents } from './inbox-events';
import { AssignmentStore, InboxStore, type ConversationRecord } from './ports';

/**
 * Turns verified WhatsApp webhook events into contacts, conversations and
 * messages. Idempotent: Meta may deliver the same event more than once.
 */
@Injectable()
export class InboxIngestService extends WhatsAppEventsSink {
  private readonly logger = new Logger(InboxIngestService.name);

  constructor(
    private readonly store: InboxStore,
    private readonly assignments: AssignmentStore,
    private readonly contacts: ContactsStore,
    private readonly events: InboxEvents,
    private readonly timeline: ConversationTimeline,
    private readonly media: InboxMediaService,
  ) {
    super();
  }

  async handle(line: LineRecord, events: WebhookEvents): Promise<void> {
    for (const message of events.messages) {
      await this.receive(line, message);
    }
    for (const status of events.statuses) {
      await this.updateStatus(line, status);
    }
  }

  private async receive(line: LineRecord, inbound: InboundMessage) {
    const { workspaceId } = line;
    if (await this.store.findMessageByWaId(workspaceId, inbound.waMessageId))
      return;
    const phone = normalizePhone(inbound.from) ?? `+${inbound.from}`;
    const contact = await this.contacts.upsertWhatsAppContact(
      workspaceId,
      phone,
      inbound.profileName,
    );
    if (contact.blocked) {
      // Never the content: only that something was dropped.
      this.logger.log(
        `Ignored a message of blocked contact ${contact.id} on line ${line.id}`,
      );
      return;
    }
    const { conversation, created, reopened } =
      await this.store.openConversation(workspaceId, {
        lineId: line.id,
        contactId: contact.id,
        contact: { name: contact.name, phone: contact.phone },
        at: inbound.timestamp,
      });

    if (reopened) {
      // The customer wrote again: the same chat comes back, unassigned.
      await this.timeline.record(conversation, {
        kind: 'reopened',
        by: null,
        from: null,
        to: null,
      });
    }

    const message = await this.store.insertMessage(workspaceId, {
      conversationId: conversation.id,
      direction: 'IN',
      type: inbound.type,
      text: inbound.text,
      media: inbound.media,
      location: inbound.location,
      contacts: inbound.contacts ?? undefined,
      reply: inbound.reply ?? null,
      waMessageId: inbound.waMessageId,
      status: 'received',
      sentBy: null,
      createdAt: inbound.timestamp,
    });
    // Already stored by a previous delivery of the same webhook.
    if (message === 'duplicate') return;

    let updated =
      (await this.store.recordActivity(workspaceId, conversation.id, {
        lastMessage: {
          text: inbound.text,
          type: inbound.type,
          direction: 'IN',
          at: inbound.timestamp,
          messageId: message.id,
          status: 'received',
        },
        inbound: true,
      })) ?? conversation;
    await this.contacts.touchLastMessage(
      workspaceId,
      contact.id,
      inbound.timestamp,
    );

    // The line's chatbot answers first; its "Transferir" applies the
    // auto-assignment when it hands the chat over.
    const botAttends = await this.botAttends(line, updated, inbound.timestamp);
    let autoAssigned = false;
    if (created && line.autoAssign && !updated.assignee && !botAttends) {
      const agent = await this.assignments.nextAgent(line.id);
      const assigned = agent
        ? await this.store.setAssignee(workspaceId, conversation.id, agent, {
            onlyIfUnassigned: true,
          })
        : null;
      if (assigned) {
        updated = assigned;
        autoAssigned = true;
      }
    }

    this.events.emit({
      workspaceId,
      type: 'message.created',
      conversation: updated,
      message,
      created,
      // The customer wrote to a closed chat: it is open again.
      ...(reopened && { previousStatus: 'CLOSED' as const }),
    });
    if (autoAssigned) {
      await this.timeline.assignment(updated, null, null, 'auto_assigned');
    }
    // Copy the file from Meta in the background: Meta deletes it after ~30 days.
    this.media.prefetch(updated, message);
  }

  /** The line's chatbot is on, within its hours and not paused in this chat. */
  private async botAttends(
    line: LineRecord,
    conversation: ConversationRecord,
    at: Date,
  ): Promise<boolean> {
    if (!line.chatbotId || conversation.bot?.paused) return false;
    const bot = await this.assignments.lineBot(line.id);
    return (
      !!bot?.enabled && withinSchedule(bot.schedule as Schedule | null, at)
    );
  }

  private async updateStatus(line: LineRecord, update: StatusUpdate) {
    const { workspaceId } = line;
    const message = await this.store.findMessageByWaId(
      workspaceId,
      update.waMessageId,
    );
    if (!message || message.direction !== 'OUT') return;
    const status = nextStatus(message.status, update.status);
    if (status === message.status) return;

    const updated = await this.store.updateMessage(workspaceId, message.id, {
      status,
      ...(status === 'failed' && { error: update.error }),
    });
    // The list shows ✓✓ of the last message: keep it in step.
    const conversation =
      (await this.store.setLastMessageStatus(
        workspaceId,
        message.conversationId,
        message.id,
        status,
      )) ??
      (await this.store.findConversation(workspaceId, message.conversationId));
    if (updated && conversation) {
      this.events.emit({
        workspaceId,
        type: 'message.updated',
        conversation,
        message: updated,
      });
    }
  }
}
