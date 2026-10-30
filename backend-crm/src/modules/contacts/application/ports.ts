import type { CursorPage } from '../../../database/mongodb/pagination';
import type { FieldType, FieldValue } from '../domain/contact-fields';

export type ContactSource = 'manual' | 'whatsapp' | 'import';
export type ContactStatus = 'ACTIVE' | 'BLOCKED';

/** «Asignación de asesores»: the contact's regular agent on one line. */
export interface LineAgent {
  lineId: string;
  membershipId: string;
}

export interface TagRecord {
  id: string;
  name: string;
  color: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactRecord {
  id: string;
  /** E.164, unique per workspace. */
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  tagIds: string[];
  source: ContactSource;
  lastMessageAt: Date | null;
  /** Blocked contacts' messages are ignored (see inbox ContactBlockService). */
  blocked: boolean;
  blockedAt: Date | null;
  blockedBy: { userId: string; name: string } | null;
  /** Regular agent per line: gets the new chats there (CONTACT_AGENT). */
  lineAgents: LineAgent[];
  /** Values of the custom fields, by field key. */
  fields: Record<string, FieldValue>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactFilter {
  /** Part of the name, email or phone. */
  search?: string;
  tagId?: string;
  status?: ContactStatus;
  cursor?: string;
  limit: number;
}

export type ContactQuery = Omit<ContactFilter, 'cursor' | 'limit'>;

export interface ContactWrite {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  tagIds: string[];
  source: ContactSource;
  createdBy: string | null;
  lineAgents?: LineAgent[];
  fields?: Record<string, FieldValue>;
}

/** Changes of a contact. `fields` merges: a null value removes that field. */
export type ContactUpdate = Partial<
  Omit<ContactWrite, 'source' | 'createdBy' | 'fields'>
> & { fields?: Record<string, FieldValue | null> };

export interface LineOption {
  lineId: string;
  name: string;
  displayPhone: string | null;
  /** Active members who attend the line (its agents and view_all members). */
  agents: { membershipId: string; name: string }[];
}

/** Lines of the workspace and who can be a contact's regular agent on each. */
export abstract class ContactAgents {
  /** Lines that are not disabled, by name. */
  abstract lineOptions(workspaceId: string): Promise<LineOption[]>;
}

/** Who is attending the contact's chat on a line right now. */
export interface Attendant {
  lineId: string;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  assignee: { membershipId: string; name: string } | null;
}

export interface ContactFieldRecord {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Definitions of the custom fields (MongoDB, `contact_fields`). */
export abstract class ContactFieldsStore {
  abstract list(workspaceId: string): Promise<ContactFieldRecord[]>;
  abstract find(
    workspaceId: string,
    fieldId: string,
  ): Promise<ContactFieldRecord | null>;
  /** 'key_taken' when another field has the same key. */
  abstract create(
    workspaceId: string,
    data: Pick<ContactFieldRecord, 'key' | 'label' | 'type' | 'options'>,
  ): Promise<ContactFieldRecord | 'key_taken'>;
  abstract update(
    workspaceId: string,
    fieldId: string,
    data: Partial<Pick<ContactFieldRecord, 'label' | 'options'>>,
  ): Promise<ContactFieldRecord | null>;
  abstract remove(workspaceId: string, fieldId: string): Promise<boolean>;
}

export interface TagWrite {
  name: string;
  color: string;
  description: string | null;
}

/**
 * Persistence of contacts and tags (MongoDB). Every method takes the
 * workspace: documents of other workspaces are never visible.
 */
export abstract class ContactsStore {
  abstract listContacts(
    workspaceId: string,
    filter: ContactFilter,
  ): Promise<CursorPage<ContactRecord>>;
  abstract findContact(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactRecord | null>;
  abstract findContactByPhone(
    workspaceId: string,
    phone: string,
  ): Promise<ContactRecord | null>;
  /** The subset of ids that are contacts of this workspace. */
  abstract existingContactIds(
    workspaceId: string,
    contactIds: readonly string[],
  ): Promise<string[]>;
  /** 'phone_taken' when the workspace already has that number. */
  abstract createContact(
    workspaceId: string,
    data: ContactWrite,
  ): Promise<ContactRecord | 'phone_taken'>;
  abstract updateContact(
    workspaceId: string,
    contactId: string,
    data: ContactUpdate,
  ): Promise<ContactRecord | 'phone_taken' | null>;
  abstract deleteContact(
    workspaceId: string,
    contactId: string,
  ): Promise<boolean>;
  /** Deletes those contacts; returns the ids that existed. */
  abstract deleteContacts(
    workspaceId: string,
    contactIds: readonly string[],
  ): Promise<string[]>;
  /** «Eliminar todos los contactos»: returns how many were deleted. */
  abstract deleteAllContacts(workspaceId: string): Promise<number>;
  /** Adds or removes tags on those contacts; returns how many changed. */
  abstract bulkTags(
    workspaceId: string,
    contactIds: readonly string[],
    tagIds: readonly string[],
    mode: 'add' | 'remove',
  ): Promise<number>;
  /** Every contact matching the query, newest first, read in batches. */
  abstract exportContacts(
    workspaceId: string,
    query: ContactQuery,
  ): AsyncIterable<ContactRecord>;
  /** The contact's chats per line, with their status and assignee. */
  abstract attendants(
    workspaceId: string,
    contactId: string,
  ): Promise<Attendant[]>;
  /** Removes a deleted custom field from every contact. */
  abstract unsetField(workspaceId: string, key: string): Promise<void>;
  /**
   * The contact of a WhatsApp sender: found by phone or created
   * (source "whatsapp"). Fills the name from the WhatsApp profile when the
   * contact has none. Safe under concurrent webhooks.
   */
  abstract upsertWhatsAppContact(
    workspaceId: string,
    phone: string,
    profileName: string | null,
  ): Promise<ContactRecord>;
  /** Blocks (with who and when) or unblocks (null) a contact. */
  abstract setBlocked(
    workspaceId: string,
    contactId: string,
    block: { at: Date; by: { userId: string; name: string } } | null,
  ): Promise<ContactRecord | null>;
  abstract touchLastMessage(
    workspaceId: string,
    contactId: string,
    at: Date,
  ): Promise<void>;
  /** Contacts with a message since `since` (limits.active_contacts). */
  abstract countActiveSince(workspaceId: string, since: Date): Promise<number>;

  /** Ids of the contacts with any of these tags (inbox tag filter). */
  abstract contactIdsWithTags(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]>;
  /** The tag ids of each of these contacts (missing contacts are left out). */
  abstract tagIdsOf(
    workspaceId: string,
    contactIds: string[],
  ): Promise<Map<string, string[]>>;

  abstract listTags(workspaceId: string): Promise<TagRecord[]>;
  /** Number of contacts per tag id. */
  abstract countContactsByTag(
    workspaceId: string,
  ): Promise<Map<string, number>>;
  /** The subset of ids that are tags of this workspace. */
  abstract existingTagIds(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]>;
  abstract findTag(
    workspaceId: string,
    tagId: string,
  ): Promise<TagRecord | null>;
  abstract createTag(
    workspaceId: string,
    data: TagWrite,
  ): Promise<TagRecord | 'name_taken'>;
  abstract updateTag(
    workspaceId: string,
    tagId: string,
    data: Partial<TagWrite>,
  ): Promise<TagRecord | 'name_taken' | null>;
  /** Deletes the tag and removes it from every contact of the workspace. */
  abstract deleteTag(workspaceId: string, tagId: string): Promise<boolean>;
}
