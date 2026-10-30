import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { ContactsEvents } from '../../contacts/application/contacts-events';
import { ContactsStore } from '../../contacts/application/ports';
import { InboxEvents } from './inbox-events';
import { InboxStore } from './ports';

/**
 * Deleting a contact keeps its chats (with a copy of its name and phone).
 * When that phone gets a contact again (it writes, or someone creates or
 * imports it), the new contact takes those chats back: the history goes on
 * in the same chat instead of a new one.
 */
@Injectable()
export class ConversationRelinker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationRelinker.name);
  private subscription?: Subscription;

  constructor(
    private readonly store: InboxStore,
    private readonly contacts: ContactsStore,
    private readonly contactEvents: ContactsEvents,
    private readonly events: InboxEvents,
  ) {}

  onModuleInit() {
    this.subscription = this.contactEvents.arrived$.subscribe((event) => {
      void (async () => {
        for (const contact of event.contacts) {
          await this.relink(event.workspaceId, contact).catch(
            (error: unknown) =>
              this.logger.error(
                `Could not give contact ${contact.id} its previous chats: ${error instanceof Error ? error.message : String(error)}`,
              ),
          );
        }
      })();
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  /** Idempotent: one query when there is nothing to take back. */
  async relink(
    workspaceId: string,
    contact: { id: string; name: string | null; phone: string },
  ): Promise<void> {
    const owners = await this.store.contactIdsWithPhone(
      workspaceId,
      contact.phone,
      contact.id,
    );
    if (owners.length === 0) return;
    // A contact that still exists (e.g. its number was changed) keeps its chats.
    const alive = new Set(
      await this.contacts.existingContactIds(workspaceId, owners),
    );
    const orphans = owners.filter((id) => !alive.has(id));
    if (orphans.length === 0) return;
    const { kept, removed } = await this.store.adoptConversations(
      workspaceId,
      {
        contactId: contact.id,
        contact: { name: contact.name, phone: contact.phone },
      },
      orphans,
    );
    for (const conversation of removed) {
      this.events.emit({
        workspaceId,
        type: 'conversation.removed',
        conversation,
      });
    }
    for (const conversation of kept) {
      this.events.emit({
        workspaceId,
        type: 'conversation.updated',
        conversation,
      });
    }
    this.logger.log(
      `Contact ${contact.id} took back ${kept.length} chat(s) of a deleted contact`,
    );
  }
}
