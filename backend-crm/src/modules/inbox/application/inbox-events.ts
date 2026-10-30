import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type {
  ConversationRecord,
  ConversationStatus,
  MessageRecord,
} from './ports';

export interface InboxEvent {
  workspaceId: string;
  /** conversation.removed: deleted (or merged into another chat). */
  type:
    | 'conversation.updated'
    | 'conversation.removed'
    | 'message.created'
    | 'message.updated';
  conversation: ConversationRecord;
  message?: MessageRecord;
  /** Assignee before the change: lets them drop a conversation that was reassigned away. */
  previousAssigneeId?: string | null;
  /** Status before the change (funnel automation runs when it differs). */
  previousStatus?: ConversationStatus;
  /** The first message of a brand-new conversation. */
  created?: boolean;
}

/**
 * Something else of the workspace changed (e.g. a funnel board): browsers
 * refetch it through the API, which checks what each member may see.
 */
export interface WorkspaceSignal {
  workspaceId: string;
  type: 'funnel.changed';
  data: { funnelId: string };
}

/**
 * In-process event bus of the inbox (server-sent events to the browsers).
 * With several API instances it must move to Redis pub/sub.
 */
@Injectable()
export class InboxEvents {
  private readonly subject = new Subject<InboxEvent>();
  private readonly signalSubject = new Subject<WorkspaceSignal>();

  readonly events$: Observable<InboxEvent> = this.subject.asObservable();
  readonly signals$: Observable<WorkspaceSignal> =
    this.signalSubject.asObservable();

  emit(event: InboxEvent): void {
    this.subject.next(event);
  }

  signal(signal: WorkspaceSignal): void {
    this.signalSubject.next(signal);
  }
}
