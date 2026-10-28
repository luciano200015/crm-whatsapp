import { Injectable } from '@nestjs/common';
import type { CursorPage } from '../../../database/mongodb/pagination';
import { csvRow } from '../../../shared/csv';
import type { RequestContext } from '../../../shared/http/request-context';
import { AuditService } from '../../audit/audit.service';
import {
  cleanOptions,
  fieldKey,
  INVALID,
  MAX_CONTACT_FIELDS,
  parseFieldValue,
  type FieldType,
  type FieldValue,
} from '../domain/contact-fields';
import { normalizePhone } from '../domain/phone';
import { normalizeTagName } from '../domain/tags';
import { ContactsErrors } from './contacts-errors';
import { ContactsEvents } from './contacts-events';
import {
  ContactAgents,
  ContactFieldsStore,
  ContactsStore,
  type ContactFieldRecord,
  type ContactFilter,
  type ContactQuery,
  type ContactRecord,
  type LineAgent,
  type LineOption,
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
  /** Custom field values by key; null or '' clears one. */
  fields?: Record<string, unknown>;
}

export interface TagInput {
  name: string;
  color: string;
  description?: string | null;
}

export interface FieldInput {
  label: string;
  type: FieldType;
  options?: string[];
}

/** One line of «Asignación de asesores». */
export interface LineAssignment extends LineOption {
  agentMembershipId: string | null;
  /** «Atendiendo ahora»: the assignee of the open or on-hold chat there. */
  attending: { membershipId: string; name: string } | null;
}

export type BulkAction = 'add_tags' | 'remove_tags' | 'delete';

export interface ImportRow {
  phone: string;
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  /** Tag names: the missing ones are created. */
  tags?: string[];
  fields?: Record<string, unknown>;
}

export interface ImportResult {
  created: number;
  updated: number;
  /** index: position of the row in the request. */
  failed: { index: number; phone: string; code: string }[];
}

interface Actor {
  userId: string;
  context: RequestContext;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Colors of the tags an import creates, in turn. */
const IMPORT_TAG_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#64748b',
];
const EXPORT_COLUMNS = [
  'Nombre',
  'Teléfono',
  'Correo',
  'Etiquetas',
  'Estado',
  'Origen',
  'Notas',
  'Último mensaje',
  'Creado',
  'Actualizado',
];
const SOURCE_LABELS = {
  manual: 'Manual',
  whatsapp: 'WhatsApp',
  import: 'Importado',
} as const;

/** Contacts, tags and custom fields of a workspace (stored in MongoDB). */
@Injectable()
export class ContactsService {
  constructor(
    private readonly store: ContactsStore,
    private readonly fieldsStore: ContactFieldsStore,
    private readonly audit: AuditService,
    private readonly agents: ContactAgents,
    private readonly events: ContactsEvents,
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
    const fields = await this.validFields(workspaceId, input.fields ?? {});
    const created = await this.store.createContact(workspaceId, {
      phone: requirePhone(input.phone),
      name: clean(input.name),
      email: clean(input.email)?.toLowerCase() ?? null,
      notes: clean(input.notes),
      tagIds: await this.validTagIds(workspaceId, input.tagIds ?? []),
      source: 'manual',
      createdBy: actor.userId,
      fields: present(fields),
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
      ...(input.fields !== undefined && {
        fields: await this.validFields(workspaceId, input.fields),
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
    this.events.removed({ workspaceId, contactIds: [contactId] });
    await this.audit.record({
      action: 'contacts.contact.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'contact',
      targetId: contactId,
      context: actor.context,
    });
  }

  // ──────────────────── Asignación de asesores ────────────────────

  /** Every line with the contact's regular agent and who attends it now. */
  async assignments(
    workspaceId: string,
    contactId: string,
  ): Promise<LineAssignment[]> {
    const contact = await this.store.findContact(workspaceId, contactId);
    if (!contact) throw ContactsErrors.contactNotFound();
    const [lines, attendants] = await Promise.all([
      this.agents.lineOptions(workspaceId),
      this.store.attendants(workspaceId, contactId),
    ]);
    return lines.map((line) => {
      const chat = attendants.find(
        (attendant) =>
          attendant.lineId === line.lineId && attendant.status !== 'CLOSED',
      );
      return {
        ...line,
        agentMembershipId:
          contact.lineAgents.find((agent) => agent.lineId === line.lineId)
            ?.membershipId ?? null,
        attending: chat?.assignee ?? null,
      };
    });
  }

  /**
   * Sets the regular agent of the given lines (null removes it); the other
   * lines keep theirs. The agent must attend that line.
   */
  async setLineAgents(
    workspaceId: string,
    contactId: string,
    entries: { lineId: string; membershipId: string | null }[],
  ): Promise<ContactView> {
    const contact = await this.store.findContact(workspaceId, contactId);
    if (!contact) throw ContactsErrors.contactNotFound();
    const lines = new Map(
      (await this.agents.lineOptions(workspaceId)).map((line) => [
        line.lineId,
        line,
      ]),
    );
    // The last entry of a line wins.
    const chosen = new Map(
      entries.map((entry) => [entry.lineId, entry.membershipId]),
    );
    for (const [lineId, membershipId] of chosen) {
      if (!membershipId) continue;
      const line = lines.get(lineId);
      if (!line) throw ContactsErrors.lineNotFound();
      if (!line.agents.some((agent) => agent.membershipId === membershipId)) {
        throw ContactsErrors.agentNotFound();
      }
    }
    const lineAgents: LineAgent[] = [
      ...contact.lineAgents.filter((agent) => !chosen.has(agent.lineId)),
      ...[...chosen].flatMap(([lineId, membershipId]) =>
        membershipId ? [{ lineId, membershipId }] : [],
      ),
    ];
    const updated = await this.store.updateContact(workspaceId, contactId, {
      lineAgents,
    });
    if (!updated || updated === 'phone_taken') {
      throw ContactsErrors.contactNotFound();
    }
    return withTags(updated, await this.tagIndex(workspaceId));
  }

  // ─────────────────────────── In bulk ───────────────────────────

  /** «Seleccionar contactos»: tag, untag or delete the selected ones. */
  async bulk(
    workspaceId: string,
    request: { contactIds: string[]; action: BulkAction; tagIds?: string[] },
    actor: Actor,
  ): Promise<{ affected: number }> {
    if (request.action === 'delete') {
      const deleted = await this.store.deleteContacts(
        workspaceId,
        request.contactIds,
      );
      if (deleted.length > 0) {
        this.events.removed({ workspaceId, contactIds: deleted });
        await this.audit.record({
          action: 'contacts.contact.bulk_deleted',
          actorUserId: actor.userId,
          workspaceId,
          targetType: 'contact',
          context: actor.context,
          metadata: { count: deleted.length },
        });
      }
      return { affected: deleted.length };
    }
    const tagIds = await this.validTagIds(workspaceId, request.tagIds ?? []);
    const affected = await this.store.bulkTags(
      workspaceId,
      request.contactIds,
      tagIds,
      request.action === 'add_tags' ? 'add' : 'remove',
    );
    return { affected };
  }

  /** «Eliminar todos los contactos». Conversations are kept. */
  async removeAll(
    workspaceId: string,
    confirmation: string,
    actor: Actor,
  ): Promise<{ deleted: number }> {
    if (confirmation !== 'ELIMINAR') {
      throw ContactsErrors.confirmationRequired();
    }
    const deleted = await this.store.deleteAllContacts(workspaceId);
    this.events.removed({ workspaceId, contactIds: 'all' });
    await this.audit.record({
      action: 'contacts.contact.all_deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      context: actor.context,
      metadata: { count: deleted },
    });
    return { deleted };
  }

  // ─────────────────────── Import and export ───────────────────────

  /**
   * «Importar contactos» (one batch of rows already mapped to fields).
   * Phones already in the workspace are updated with the non-empty values
   * of the row; tags are rewritten or combined. A bad row fails alone.
   */
  async import(
    workspaceId: string,
    request: { rows: ImportRow[]; tagMode: 'REPLACE' | 'MERGE' },
    actor: Actor,
  ): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, failed: [] };
    const definitions = await this.fieldsStore.list(workspaceId);
    const tagIds = await this.tagResolver(workspaceId);

    for (const [index, row] of request.rows.entries()) {
      const fail = (code: string) =>
        result.failed.push({ index, phone: row.phone, code });
      const phone = normalizePhone(row.phone);
      if (!phone) {
        fail('INVALID_PHONE');
        continue;
      }
      const email = clean(row.email)?.toLowerCase() ?? null;
      if (email && (!EMAIL.test(email) || email.length > 320)) {
        fail('INVALID_EMAIL');
        continue;
      }
      const fields = parseFields(definitions, row.fields ?? {});
      if (fields === INVALID) {
        fail('CONTACT_FIELD_INVALID_VALUE');
        continue;
      }
      const tags = await tagIds(row.tags ?? []);
      const values = {
        name: clean(row.name)?.slice(0, 120) ?? null,
        email,
        notes: clean(row.notes)?.slice(0, 2000) ?? null,
      };

      const existing = await this.store.findContactByPhone(workspaceId, phone);
      if (existing) {
        await this.store.updateContact(workspaceId, existing.id, {
          ...(values.name && { name: values.name }),
          ...(values.email && { email: values.email }),
          ...(values.notes && { notes: values.notes }),
          ...(tags.length > 0 && {
            tagIds:
              request.tagMode === 'REPLACE'
                ? tags
                : [...new Set([...existing.tagIds, ...tags])],
          }),
          fields: present(fields),
        });
        result.updated++;
        continue;
      }
      const created = await this.store.createContact(workspaceId, {
        phone,
        ...values,
        tagIds: tags,
        source: 'import',
        createdBy: actor.userId,
        fields: present(fields),
      });
      if (created === 'phone_taken') {
        // Created by a webhook meanwhile: it counts as an update next time.
        fail('CONTACT_PHONE_TAKEN');
        continue;
      }
      result.created++;
    }

    await this.audit.record({
      action: 'contacts.contact.imported',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      context: actor.context,
      metadata: {
        created: result.created,
        updated: result.updated,
        failed: result.failed.length,
      },
    });
    return result;
  }

  /** CSV of the contacts matching the query (all of them without filters). */
  async export(
    workspaceId: string,
    query: ContactQuery,
    actor: Actor,
  ): Promise<{ filename: string; lines: AsyncIterable<string> }> {
    const [tags, fields] = await Promise.all([
      this.tagIndex(workspaceId),
      this.fieldsStore.list(workspaceId),
    ]);
    await this.audit.record({
      action: 'contacts.contact.exported',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      context: actor.context,
      metadata: { filtered: Object.values(query).some(Boolean) },
    });
    const store = this.store;
    async function* lines(): AsyncIterable<string> {
      yield `\uFEFF${csvRow([...EXPORT_COLUMNS, ...fields.map((f) => f.label)])}\r\n`;
      for await (const contact of store.exportContacts(workspaceId, query)) {
        const row = [
          contact.name,
          contact.phone,
          contact.email,
          contact.tagIds.flatMap((id) => tags.get(id)?.name ?? []).join(', '),
          contact.blocked ? 'Bloqueado' : 'Activo',
          SOURCE_LABELS[contact.source],
          contact.notes,
          contact.lastMessageAt?.toISOString() ?? null,
          contact.createdAt.toISOString(),
          contact.updatedAt.toISOString(),
          ...fields.map((field) => contact.fields[field.key] ?? null),
        ];
        yield `${csvRow(row)}\r\n`;
      }
    }
    return { filename: 'contactos.csv', lines: lines() };
  }

  // ─────────────────────── Custom fields ───────────────────────

  listFields(workspaceId: string): Promise<ContactFieldRecord[]> {
    return this.fieldsStore.list(workspaceId);
  }

  async createField(
    workspaceId: string,
    input: FieldInput,
  ): Promise<ContactFieldRecord> {
    const label = input.label.trim();
    const key = fieldKey(label);
    if (!key) throw ContactsErrors.fieldInvalidLabel();
    const options =
      input.type === 'SELECT' ? cleanOptions(input.options ?? []) : [];
    if (input.type === 'SELECT' && options.length === 0) {
      throw ContactsErrors.fieldOptionsRequired();
    }
    const existing = await this.fieldsStore.list(workspaceId);
    if (existing.length >= MAX_CONTACT_FIELDS) {
      throw ContactsErrors.fieldsLimit(MAX_CONTACT_FIELDS);
    }
    const created = await this.fieldsStore.create(workspaceId, {
      key,
      label,
      type: input.type,
      options,
    });
    if (created === 'key_taken') throw ContactsErrors.fieldTaken();
    return created;
  }

  /** Renames a field or changes its options; the key and type stay. */
  async updateField(
    workspaceId: string,
    fieldId: string,
    input: { label?: string; options?: string[] },
  ): Promise<ContactFieldRecord> {
    const field = await this.fieldsStore.find(workspaceId, fieldId);
    if (!field) throw ContactsErrors.fieldNotFound();
    const label = input.label?.trim();
    if (label !== undefined) {
      if (!fieldKey(label)) throw ContactsErrors.fieldInvalidLabel();
      const others = await this.fieldsStore.list(workspaceId);
      if (
        others.some(
          (other) =>
            other.id !== field.id && fieldKey(other.label) === fieldKey(label),
        )
      ) {
        throw ContactsErrors.fieldTaken();
      }
    }
    const options =
      field.type === 'SELECT' && input.options !== undefined
        ? cleanOptions(input.options)
        : undefined;
    if (options?.length === 0) throw ContactsErrors.fieldOptionsRequired();
    const updated = await this.fieldsStore.update(workspaceId, fieldId, {
      ...(label !== undefined && { label }),
      ...(options && { options }),
    });
    if (!updated) throw ContactsErrors.fieldNotFound();
    return updated;
  }

  /** Deletes the field and its values from every contact. */
  async removeField(
    workspaceId: string,
    fieldId: string,
    actor: Actor,
  ): Promise<void> {
    const field = await this.fieldsStore.find(workspaceId, fieldId);
    if (!field || !(await this.fieldsStore.remove(workspaceId, fieldId))) {
      throw ContactsErrors.fieldNotFound();
    }
    await this.store.unsetField(workspaceId, field.key);
    await this.audit.record({
      action: 'contacts.field.deleted',
      actorUserId: actor.userId,
      workspaceId,
      targetType: 'contact_field',
      targetId: fieldId,
      context: actor.context,
      metadata: { key: field.key },
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
  private async validTagIds(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    const existing = await this.store.existingTagIds(workspaceId, unique);
    if (existing.length !== unique.length) throw ContactsErrors.tagNotFound();
    return unique;
  }

  /** Values of known fields only; null clears one. */
  private async validFields(
    workspaceId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, FieldValue | null>> {
    if (Object.keys(input).length === 0) return {};
    const definitions = await this.fieldsStore.list(workspaceId);
    const result: Record<string, FieldValue | null> = {};
    for (const [key, raw] of Object.entries(input)) {
      const field = definitions.find((definition) => definition.key === key);
      if (!field) throw ContactsErrors.fieldNotFound();
      const value = parseFieldValue(field, raw);
      if (value === INVALID) {
        throw ContactsErrors.fieldInvalidValue(field.label);
      }
      result[key] = value;
    }
    return result;
  }

  /** Tag ids by name for an import, creating the missing tags once. */
  private async tagResolver(
    workspaceId: string,
  ): Promise<(names: string[]) => Promise<string[]>> {
    const byName = new Map(
      (await this.store.listTags(workspaceId)).map((tag) => [
        normalizeTagName(tag.name),
        tag.id,
      ]),
    );
    let created = 0;
    return async (names) => {
      const ids: string[] = [];
      for (const raw of names) {
        const name = raw.trim().slice(0, 40);
        if (!name) continue;
        const normalized = normalizeTagName(name);
        let id = byName.get(normalized);
        if (!id) {
          const tag = await this.store.createTag(workspaceId, {
            name,
            color:
              IMPORT_TAG_COLORS[created++ % IMPORT_TAG_COLORS.length] ??
              '#64748b',
            description: null,
          });
          // Created meanwhile by someone else: read it back.
          id =
            tag === 'name_taken'
              ? (await this.store.listTags(workspaceId)).find(
                  (other) => normalizeTagName(other.name) === normalized,
                )?.id
              : tag.id;
          if (id) byName.set(normalized, id);
        }
        if (id && !ids.includes(id)) ids.push(id);
      }
      return ids;
    };
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

/** Import values of known fields; unknown keys are skipped. */
function parseFields(
  definitions: ContactFieldRecord[],
  input: Record<string, unknown>,
): Record<string, FieldValue | null> | typeof INVALID {
  const result: Record<string, FieldValue | null> = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = definitions.find((definition) => definition.key === key);
    if (!field) continue;
    const value = parseFieldValue(field, raw);
    if (value === INVALID) return INVALID;
    if (value !== null) result[key] = value;
  }
  return result;
}

/** Without the cleared (null) values. */
function present(
  fields: Record<string, FieldValue | null>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, FieldValue] => entry[1] !== null,
    ),
  );
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
