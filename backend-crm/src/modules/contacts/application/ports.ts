import type { CursorPage } from '../../../database/mongodb/pagination';

export type ContactSource = 'manual' | 'whatsapp';

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
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactFilter {
  /** Part of the name, email or phone. */
  search?: string;
  tagId?: string;
  cursor?: string;
  limit: number;
}

export interface ContactWrite {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  tagIds: string[];
  source: ContactSource;
  createdBy: string | null;
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
  /** 'phone_taken' when the workspace already has that number. */
  abstract createContact(
    workspaceId: string,
    data: ContactWrite,
  ): Promise<ContactRecord | 'phone_taken'>;
  abstract updateContact(
    workspaceId: string,
    contactId: string,
    data: Partial<Omit<ContactWrite, 'source' | 'createdBy'>>,
  ): Promise<ContactRecord | 'phone_taken' | null>;
  abstract deleteContact(
    workspaceId: string,
    contactId: string,
  ): Promise<boolean>;
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
  abstract touchLastMessage(
    workspaceId: string,
    contactId: string,
    at: Date,
  ): Promise<void>;
  /** Contacts with a message since `since` (limits.active_contacts). */
  abstract countActiveSince(workspaceId: string, since: Date): Promise<number>;

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
