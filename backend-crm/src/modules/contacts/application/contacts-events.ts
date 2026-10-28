import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface ContactsRemoved {
  workspaceId: string;
  /** 'all': «Eliminar todos los contactos». */
  contactIds: string[] | 'all';
}

/**
 * Contacts that were deleted, so other modules (funnels) drop what pointed
 * at them. Conversations keep their copy of the name and phone.
 */
@Injectable()
export class ContactsEvents {
  private readonly removedSubject = new Subject<ContactsRemoved>();
  readonly removed$ = this.removedSubject.asObservable();

  removed(event: ContactsRemoved): void {
    this.removedSubject.next(event);
  }
}
