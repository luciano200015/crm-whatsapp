import { Injectable } from '@nestjs/common';
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
import { nextStatus } from '../domain/inbox-rules';
import { ConversationTimeline } from './conversation-timeline';
import { InboxEvents } from './inbox-events';
import { AssignmentStore, InboxStore } from './ports';

/**
 * Turns verified WhatsApp webhook events into contacts, conversations and
 * messages. Idempotent: Meta may deliver the same event more than once.
 */
@Injectable()
export class InboxIngestService extends WhatsAppEventsSink {
  constructor(
    private readonly store: InboxStore,
    private readonly assignments: AssignmentStore,
    private readonly contacts: ContactsStore,
    private readonly events: InboxEvents,
    private readonly timeline: ConversationTimeline,
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
    const { conversation, created } = await this.store.openConversation(
      workspaceId,
      {
        lineId: line.id,
        contactId: contact.id,
        contact: { name: contact.name, phone: contact.phone },
        at: inbound.timestamp,
      },
    );

    const message = await this.store.insertMessage(workspaceId, {
      conversationId: conversation.id,
      direction: 'IN',
      type: inbound.type,
      text: inbound.text,
      media: inbound.media,
      location: inbound.location,
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
        },
        inbound: true,
      })) ?? conversation;
    await this.contacts.touchLastMessage(
      workspaceId,
      contact.id,
      inbound.timestamp,
    );

    let autoAssigned = false;
    if (created && line.autoAssign && !updated.assignee) {
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
    });
    if (autoAssigned) {
      await this.timeline.assignment(updated, null, null, 'auto_assigned');
    }
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
    const conversation = await this.store.findConversation(
      workspaceId,
      message.conversationId,
    );
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
