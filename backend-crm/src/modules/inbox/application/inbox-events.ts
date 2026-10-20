import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { ConversationRecord, MessageRecord } from './ports';

export interface InboxEvent {
  workspaceId: string;
  type: 'conversation.updated' | 'message.created' | 'message.updated';
  conversation: ConversationRecord;
  message?: MessageRecord;
  /** Assignee before the change: lets them drop a conversation that was reassigned away. */
  previousAssigneeId?: string | null;
}

/**
 * In-process event bus of the inbox (server-sent events to the browsers).
 * With several API instances it must move to Redis pub/sub.
 */
@Injectable()
export class InboxEvents {
  private readonly subject = new Subject<InboxEvent>();

  readonly events$: Observable<InboxEvent> = this.subject.asObservable();

  emit(event: InboxEvent): void {
    this.subject.next(event);
  }
}
