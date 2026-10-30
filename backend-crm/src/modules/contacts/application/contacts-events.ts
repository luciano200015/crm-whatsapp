import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface ContactsRemoved {
  workspaceId: string;
  /** 'all': «Eliminar todos los contactos». */
  contactIds: string[] | 'all';
}

/** Contacts that now own a phone: created, imported or given a new number. */
export interface ContactsArrived {
  workspaceId: string;
  contacts: Array<{ id: string; name: string | null; phone: string }>;
}

/**
 * Contacts that were deleted, so other modules (funnels) drop what pointed
 * at them; and contacts that took a phone, so the inbox gives them the chats
 * a deleted contact with that phone left behind.
 */
@Injectable()
export class ContactsEvents {
  private readonly removedSubject = new Subject<ContactsRemoved>();
  private readonly arrivedSubject = new Subject<ContactsArrived>();
  readonly removed$ = this.removedSubject.asObservable();
  readonly arrived$ = this.arrivedSubject.asObservable();

  removed(event: ContactsRemoved): void {
    this.removedSubject.next(event);
  }

  arrived(event: ContactsArrived): void {
    if (event.contacts.length > 0) this.arrivedSubject.next(event);
  }
}
