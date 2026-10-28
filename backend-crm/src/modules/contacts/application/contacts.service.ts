import { Injectable } from '@nestjs/common';
import type { CursorPage } from '../../../database/mongodb/pagination';
import type { RequestContext } from '../../../shared/http/request-context';
import { AuditService } from '../../audit/audit.service';
import { normalizePhone } from '../domain/phone';
import { ContactsErrors } from './contacts-errors';
import {
  ContactAgents,
  ContactsStore,
  type ContactFilter,
  type ContactRecord,
  type TagRecord,
} from './ports';

export interface TagSummary {
  id: string;
  name: string;
  color: string;
}

export interface ContactView extends Omit<ContactRecord, 'tagIds'> {
  tags: TagSummary[];
}

export interface TagView extends TagRecord {
  contactCount: number;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  tagIds?: string[];
  agentMembershipId?: string | null;
}

export interface TagInput {
  name: string;
  color: string;
  description?: string | null;
}

interface Actor {
  userId: string;
  context: RequestContext;
}

/** Contacts and tags of a workspace (stored in MongoDB). */
@Injectable()
export class ContactsService {
  constructor(
    private readonly store: ContactsStore,
    private readonly audit: AuditService,
    private readonly agents: ContactAgents,
  ) {}

  // ─────────────────────────── Contacts ───────────────────────────

  async list(
    workspaceId: string,
    filter: ContactFilter,
  ): Promise<CursorPage<ContactView>> {
    const [page, tags] = await Promise.all([
      this.store.listContacts(workspaceId, filter),
      this.tagIndex(workspaceId),
    ]);
    return {
      items: page.items.map((contact) => withTags(contact, tags)),
      nextCursor: page.nextCursor,
    };
  }

  async get(workspaceId: string, contactId: string): Promise<ContactView> {
    const contact = await this.store.findContact(workspaceId, contactId);
    if (!contact) throw ContactsErrors.contactNotFound();
    return withTags(contact, await this.tagIndex(workspaceId));
  }

  async create(
    workspaceId: string,
    input: ContactInput,
    actor: Actor,
  ): Promise<ContactView> {
    const created = await this.store.createContact(workspaceId, {
      phone: requirePhone(input.phone),
      name: clean(input.name),
      email: clean(input.email)?.toLowerCase() ?? null,
      notes: clean(input.notes),
      tagIds: await this.validTagIds(workspaceId, input.tagIds ?? []),
      source: 'manual',
      createdBy: actor.userId,
    });
    if (created === 'phone_taken') throw ContactsErrors.phoneTaken();
    return withTags(created, await this.tagIndex(workspaceId));
  }

  async update(
    workspaceId: string,
    contactId: string,
    input: Partial<ContactInput>,
  ): Promise<ContactView> {
    const updated = await this.store.updateContact(workspaceId, contactId, {
      ...(input.phone !== undefined && { phone: requirePhone(input.phone) }),
      ...(input.name !== undefined && { name: clean(input.name) }),
      ...(input.email !== undefined && {
        email: clean(input.email)?.toLowerCase() ?? null,
      }),
      ...(input.notes !== undefined && { notes: clean(input.notes) }),
      ...(input.tagIds !== undefined && {
        tagIds: await this.validTagIds(workspaceId, input.tagIds),
      }),
      ...(input.agentMembershipId !== undefined && {
        agentMembershipId: await this.validAgent(
          workspaceId,
          input.agentMembershipId,
        ),
      }),
    });
    if (updated === 'phone_taken') throw ContactsErrors.phoneTaken();
    if (!updated) throw ContactsErrors.contactNotFound();
    return withTags(updated, await this.tagIndex(workspaceId));
  }

  setTags(
    workspaceId: string,
    contactId: string,
    tagIds: string[],
  ): Promise<ContactView> {
    return this.update(workspaceId, contactId, { tagIds });
  }

  async remove(
    workspaceId: string,
    contactId: string,
    actor: Actor,
  ): Promise<void> {
    if (!(await this.store.deleteContact(workspaceId, contactId))) {
      throw ContactsErrors.contactNotFound();
    }
    await this.audit.record({
      action: 'contacts.contact.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'contact',
      targetId: contactId,
      context: actor.context,
    });
  }

  // ─────────────────────────── Tags ───────────────────────────

  async listTags(workspaceId: string): Promise<TagView[]> {
    const [tags, counts] = await Promise.all([
      this.store.listTags(workspaceId),
      this.store.countContactsByTag(workspaceId),
    ]);
    return tags.map((tag) => ({
      ...tag,
      contactCount: counts.get(tag.id) ?? 0,
    }));
  }

  async createTag(workspaceId: string, input: TagInput): Promise<TagView> {
    const created = await this.store.createTag(workspaceId, {
      name: input.name.trim(),
      color: input.color.toLowerCase(),
      description: clean(input.description),
    });
    if (created === 'name_taken') throw ContactsErrors.tagNameTaken();
    return { ...created, contactCount: 0 };
  }

  async updateTag(
    workspaceId: string,
    tagId: string,
    input: Partial<TagInput>,
  ): Promise<TagView> {
    const updated = await this.store.updateTag(workspaceId, tagId, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.color !== undefined && { color: input.color.toLowerCase() }),
      ...(input.description !== undefined && {
        description: clean(input.description),
      }),
    });
    if (updated === 'name_taken') throw ContactsErrors.tagNameTaken();
    if (!updated) throw ContactsErrors.tagNotFound();
    const counts = await this.store.countContactsByTag(workspaceId);
    return { ...updated, contactCount: counts.get(updated.id) ?? 0 };
  }

  async removeTag(
    workspaceId: string,
    tagId: string,
    actor: Actor,
  ): Promise<void> {
    if (!(await this.store.deleteTag(workspaceId, tagId))) {
      throw ContactsErrors.tagNotFound();
    }
    await this.audit.record({
      action: 'contacts.tag.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'tag',
      targetId: tagId,
      context: actor.context,
    });
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private async tagIndex(
    workspaceId: string,
  ): Promise<Map<string, TagSummary>> {
    const tags = await this.store.listTags(workspaceId);
    return new Map(
      tags.map(({ id, name, color }) => [id, { id, name, color }]),
    );
  }

  /** Tags must belong to the workspace: a foreign or unknown id is an error. */
  /** null clears it; otherwise an active member of the workspace. */
  private async validAgent(
    workspaceId: string,
    membershipId: string | null,
  ): Promise<string | null> {
    if (!membershipId) return null;
    if (!(await this.agents.isActiveMember(workspaceId, membershipId))) {
      throw ContactsErrors.agentNotFound();
    }
    return membershipId;
  }

  private async validTagIds(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    const existing = await this.store.existingTagIds(workspaceId, unique);
    if (existing.length !== unique.length) throw ContactsErrors.tagNotFound();
    return unique;
  }
}

function withTags(
  contact: ContactRecord,
  tags: Map<string, TagSummary>,
): ContactView {
  const { tagIds, ...rest } = contact;
  return {
    ...rest,
    // A tag deleted concurrently may linger in tagIds: it is simply skipped.
    tags: tagIds.flatMap((id) => tags.get(id) ?? []),
  };
}

function requirePhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone) throw ContactsErrors.invalidPhone();
  return phone;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
