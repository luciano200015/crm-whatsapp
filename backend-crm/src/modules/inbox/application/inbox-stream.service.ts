import { Injectable, type MessageEvent } from '@nestjs/common';
import {
  concatMap,
  filter,
  from,
  timer,
  map,
  merge,
  type Observable,
  takeWhile,
  takeUntil,
} from 'rxjs';
import { AuthorizationService } from '../../authorization/application/authorization.service';
import { AuthService } from '../../auth/application/auth.service';
import { canSee, type InboxScope } from '../domain/inbox-rules';
import { InboxEvents, type InboxEvent } from './inbox-events';
import { InboxService, toMessageView, type InboxActor } from './inbox.service';
import { AssignmentStore } from './ports';

const PING_MS = 25_000;

/**
 * Server-sent events for one member. Only events about conversations they
 * may see are sent; when a conversation stops being visible (e.g. it was
 * reassigned) they get `conversation.removed`. Session and permissions are
 * checked before every event and heartbeat; token expiry ends the stream.
 */
@Injectable()
export class InboxStreamService {
  constructor(
    private readonly events: InboxEvents,
    private readonly inbox: InboxService,
    private readonly assignments: AssignmentStore,
    private readonly authorization: AuthorizationService,
    private readonly auth: AuthService,
  ) {}

  stream(actor: InboxActor, token: string): Observable<MessageEvent> {
    const { workspaceId } = actor.access;
    let scope: InboxScope | null = null;
    let allowed = true;

    const refreshScope = async () => {
      const session = await this.auth.authenticate(token);
      if (
        !session ||
        session.userId !== actor.userId ||
        session.mustChangePassword
      ) {
        allowed = false;
        scope = null;
        return false;
      }
      const access = await this.authorization.resolveAccess(
        actor.userId,
        workspaceId,
      );
      allowed = access?.permissions.has('messages.read') ?? false;
      if (access) scope = await this.inbox.scope({ ...actor, access });
      return allowed;
    };

    return merge(
      this.events.events$.pipe(
        filter((event) => event.workspaceId === workspaceId),
      ),
      timer(0, PING_MS).pipe(map(() => null)),
    ).pipe(
      concatMap((event) =>
        from(
          (async () => {
            await refreshScope();
            if (!allowed) return false as const;
            return event
              ? this.toMessage(event, scope)
              : { type: 'ping', data: {} };
          })(),
        ),
      ),
      takeWhile((message) => message !== false),
      filter((message): message is MessageEvent => message !== null),
      takeUntil(timer(expiryDelay(token))),
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
      return event.previousAssigneeId === scope.membershipId ||
        (event.previousAssigneeId === null &&
          scope.lineIds.includes(conversation.lineId))
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

function expiryDelay(token: string): number {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('exp' in payload) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    )
      return 0;
    return Math.max(
      0,
      Math.min(2_147_483_647, payload.exp * 1000 - Date.now()),
    );
  } catch {
    return 0;
  }
}
