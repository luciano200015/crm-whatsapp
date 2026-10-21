import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/time/clock';
import { InboxEvents } from './inbox-events';
import {
  InboxStore,
  type Assignee,
  type ConversationEvent,
  type ConversationEventKind,
  type ConversationRecord,
} from './ports';

const party = (assignee: Assignee | null) =>
  assignee
    ? { membershipId: assignee.membershipId, name: assignee.name }
    : null;

/**
 * Movements of a conversation (assignments, transfers, close, reopen…)
 * written into its history as EVENT messages, so the chat shows them in the
 * middle like WhatsApp's system notices. They never change the preview.
 */
@Injectable()
export class ConversationTimeline {
  constructor(
    private readonly store: InboxStore,
    private readonly events: InboxEvents,
    private readonly clock: Clock,
  ) {}

  /** The event of an assignment change, or nothing when it did not change. */
  async assignment(
    conversation: ConversationRecord,
    before: Assignee | null,
    by: Assignee | null,
    kind?: Extract<
      ConversationEventKind,
      'taken' | 'claimed' | 'auto_assigned'
    >,
  ): Promise<void> {
    const after = conversation.assignee;
    if (before?.membershipId === after?.membershipId) return;
    const resolved: ConversationEventKind =
      kind ?? (!after ? 'unassigned' : before ? 'transferred' : 'assigned');
    await this.record(conversation, {
      kind: resolved,
      by: by ? { userId: by.userId, name: by.name } : null,
      from: party(before),
      to: party(after),
    });
  }

  async record(
    conversation: ConversationRecord,
    event: ConversationEvent,
  ): Promise<void> {
    const message = await this.store.insertMessage(conversation.workspaceId, {
      conversationId: conversation.id,
      direction: 'EVENT',
      type: 'text',
      text: null,
      media: null,
      location: null,
      event,
      waMessageId: null,
      status: 'sent',
      sentBy: null,
      createdAt: this.clock.now(),
    });
    if (message === 'duplicate') return;
    this.events.emit({
      workspaceId: conversation.workspaceId,
      type: 'message.created',
      conversation,
      message,
    });
  }
}
