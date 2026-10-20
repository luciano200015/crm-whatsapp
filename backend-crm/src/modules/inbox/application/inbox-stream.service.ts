import { Injectable, type MessageEvent } from '@nestjs/common';
import {
  concatMap,
  filter,
  from,
  interval,
  map,
  merge,
  type Observable,
  switchMap,
  takeWhile,
} from 'rxjs';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { canSee, type InboxScope } from '../domain/inbox-rules';
import { InboxEvents, type InboxEvent } from './inbox-events';
import { InboxService, toMessageView, type InboxActor } from './inbox.service';
import { AssignmentStore } from './ports';

const PING_MS = 25_000;
const RECHECK_MS = 60_000;

/**
 * Server-sent events for one member. Only events about conversations they
 * may see are sent; when a conversation stops being visible (e.g. it was
 * reassigned) they get `conversation.removed`. Access is re-checked every
 * minute: a deactivated member or a revoked permission ends the stream.
 */
@Injectable()
export class InboxStreamService {
  constructor(
    private readonly events: InboxEvents,
    private readonly inbox: InboxService,
    private readonly assignments: AssignmentStore,
    private readonly authorization: AuthorizationService,
  ) {}

  stream(actor: InboxActor): Observable<MessageEvent> {
    const { workspaceId } = actor.access;
    let scope: InboxScope | null = null;
    let allowed = true;

    const refreshScope = async () => {
      const access = await this.authorization.resolveAccess(
        actor.userId,
        workspaceId,
      );
      allowed = access?.permissions.has('messages.read') ?? false;
      if (access) scope = await this.inbox.scope({ ...actor, access });
      return allowed;
    };

    const updates = this.events.events$.pipe(
      filter((event) => event.workspaceId === workspaceId),
      concatMap((event) => from(this.toMessage(event, scope))),
      filter((message): message is MessageEvent => message !== null),
    );
    const pings = interval(PING_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    const rechecks = interval(RECHECK_MS).pipe(
      concatMap(() => from(refreshScope())),
      filter(() => false),
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );

    return from(refreshScope()).pipe(
      switchMap(() => merge(updates, pings, rechecks)),
      takeWhile(() => allowed),
    );
  }

  private async toMessage(
    event: InboxEvent,
    scope: InboxScope | null,
  ): Promise<MessageEvent | null> {
    if (!scope) return null;
    const { conversation } = event;
    if (!canSee(conversation, scope)) {
      // Visible before the change (it was mine): tell the client to drop it.
      return event.previousAssigneeId === scope.membershipId
        ? { type: 'conversation.removed', data: { id: conversation.id } }
        : null;
    }
    const names = await this.assignments.lineNames(conversation.workspaceId);
    return {
      type: event.type,
      data: {
        conversation: this.inbox.toView(conversation, names),
        ...(event.message && { message: toMessageView(event.message) }),
      },
    };
  }
}
