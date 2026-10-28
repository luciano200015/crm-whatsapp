import { Injectable } from '@nestjs/common';
import { ContactsStore } from '../../contacts/application/ports';
import { pickLeastBusy } from '../domain/inbox-rules';
import { ChatSettingsService } from './chat-settings';
import { InboxPresence } from './inbox-presence';
import { AssignmentStore, InboxStore, type Assignee } from './ports';

export interface AutoAssignRequest {
  workspaceId: string;
  lineId: string;
  contactId: string;
  /**
   * 'arrival': a customer's message opened (or reopened) the chat.
   * 'bot': the chatbot's «Transferir» to the auto-assignment.
   */
  trigger: 'arrival' | 'bot';
  /** The chat was closed and the customer wrote again. */
  reopened?: boolean;
  /** The line's own switch, used until the workspace saves its settings. */
  lineAutoAssign: boolean;
}

/**
 * Who gets a chat nobody attends, following «Configuración del módulo de
 * chat». Picks are serialized per line, so two chats arriving together go
 * to different agents when they are tied.
 */
@Injectable()
export class AutoAssigner {
  private readonly lastAssigned = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly settings: ChatSettingsService,
    private readonly presence: InboxPresence,
    private readonly assignments: AssignmentStore,
    private readonly store: InboxStore,
    private readonly contacts: ContactsStore,
  ) {}

  pick(request: AutoAssignRequest): Promise<Assignee | null> {
    const previous = this.queues.get(request.lineId) ?? Promise.resolve();
    const next = previous.then(
      () => this.choose(request),
      () => this.choose(request),
    );
    const settled = next.catch(() => undefined);
    this.queues.set(request.lineId, settled);
    void settled.then(() => {
      if (this.queues.get(request.lineId) === settled) {
        this.queues.delete(request.lineId);
      }
    });
    return next;
  }

  private async choose(request: AutoAssignRequest): Promise<Assignee | null> {
    const { workspaceId, lineId } = request;
    const settings = await this.settings.get(workspaceId);
    if (settings.legacyAssignment) {
      // Before the settings are saved: each line's switch and round-robin.
      if (request.trigger === 'arrival') {
        if (!request.lineAutoAssign || request.reopened) return null;
      }
      return this.assignments.nextAgent(lineId);
    }
    const { mode, includeAdmins } = settings.assignment;
    if (mode === 'NONE') return null;

    const members = await this.assignments.membersReach(workspaceId);
    if (mode === 'CONTACT_AGENT') {
      const contact = await this.contacts.findContact(
        workspaceId,
        request.contactId,
      );
      const regular = members.find(
        (member) => member.membershipId === contact?.agentMembershipId,
      );
      // The regular agent gets it even when away; one who left the line does not.
      if (regular && (regular.viewAll || regular.lineIds.includes(lineId))) {
        return toAssignee(regular);
      }
    }

    const connected = this.presence.connectedUserIds(workspaceId);
    let candidates = members.filter(
      (member) =>
        member.lineIds.includes(lineId) && connected.has(member.userId),
    );
    if (candidates.length === 0 && includeAdmins) {
      candidates = members.filter(
        (member) => member.viewAll && connected.has(member.userId),
      );
    }
    if (candidates.length === 0) return null;

    const ids = candidates.map((member) => member.membershipId);
    const load = await this.store.openChatsOf(workspaceId, ids);
    const chosenId = pickLeastBusy(
      ids,
      load,
      this.lastAssigned.get(lineId) ?? null,
    );
    const chosen = candidates.find(
      (member) => member.membershipId === chosenId,
    );
    if (!chosen) return null;
    this.lastAssigned.set(lineId, chosen.membershipId);
    return toAssignee(chosen);
  }
}

const toAssignee = (member: {
  membershipId: string;
  userId: string;
  name: string;
}): Assignee => ({
  membershipId: member.membershipId,
  userId: member.userId,
  name: member.name,
});
