import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types, type QueryFilter, type Model } from 'mongoose';
import {
  afterCursor,
  escapeRegex,
  toPage,
  type CursorPage,
} from '../../../database/mongodb/pagination';
import {
  ContactsStore,
  type Attendant,
  type ContactFilter,
  type ContactQuery,
  type ContactRecord,
  type ContactUpdate,
  type ContactWrite,
  type TagRecord,
  type TagWrite,
} from '../application/ports';
import { normalizeTagName } from '../domain/tags';
import {
  CONTACT_MODEL,
  TAG_MODEL,
  type ContactDocument,
  type TagDocument,
} from './contact.schemas';

const DUPLICATE_KEY = 11000;
const CONVERSATIONS = 'conversations';
const EXPORT_BATCH = 1000;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY
  );
}

const objectId = (id: string): Types.ObjectId | null =>
  isValidObjectId(id) ? new Types.ObjectId(id) : null;

const objectIds = (ids: readonly string[]): Types.ObjectId[] =>
  ids.map(objectId).filter((id): id is Types.ObjectId => id !== null);

/** The Mongo filter of a list or export; null when nothing can match. */
function contactQuery(
  workspaceId: string,
  query: ContactQuery,
): QueryFilter<ContactDocument> | null {
  const search = query.search?.trim();
  const tagId = query.tagId ? objectId(query.tagId) : undefined;
  if (query.tagId && !tagId) return null;
  const pattern = search ? new RegExp(escapeRegex(search), 'i') : null;
  const digits = search?.replace(/\D/g, '');
  return {
    workspaceId,
    ...(tagId && { tagIds: tagId }),
    ...(query.status === 'BLOCKED' && { blocked: true }),
    ...(query.status === 'ACTIVE' && { blocked: { $ne: true } }),
    ...(pattern && {
      $or: [
        { name: pattern },
        { email: pattern },
        ...(digits ? [{ phone: new RegExp(escapeRegex(digits)) }] : []),
      ],
    }),
  };
}

function toContact(doc: ContactDocument): ContactRecord {
  return {
    id: doc._id.toHexString(),
    phone: doc.phone,
    name: doc.name,
    email: doc.email,
    notes: doc.notes,
    tagIds: doc.tagIds.map((id) => id.toHexString()),
    source: doc.source,
    lastMessageAt: doc.lastMessageAt,
    blocked: doc.blocked ?? false,
    blockedAt: doc.blockedAt ?? null,
    blockedBy: doc.blockedBy ?? null,
    lineAgents: (doc.lineAgents ?? []).map(({ lineId, membershipId }) => ({
      lineId,
      membershipId,
    })),
    fields: { ...(doc.fields ?? {}) },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toTag(doc: TagDocument): TagRecord {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    color: doc.color,
    description: doc.description,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoContactsStore extends ContactsStore implements OnModuleInit {
  constructor(
    @InjectModel(CONTACT_MODEL)
    private readonly contacts: Model<ContactDocument>,
    @InjectModel(TAG_MODEL) private readonly tags: Model<TagDocument>,
  ) {
    super();
  }

  /** Unique indexes must exist before the first write (autoIndex is off). */
  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.contacts.createIndexes(),
      this.tags.createIndexes(),
    ]);
  }

  // ─────────────────────────── Contacts ───────────────────────────

  async listContacts(
    workspaceId: string,
    filter: ContactFilter,
  ): Promise<CursorPage<ContactRecord>> {
    const query = contactQuery(workspaceId, filter);
    if (!query) return { items: [], nextCursor: null };
    const rows = await this.contacts
      .find({ ...query, ...afterCursor(filter.cursor) })
      .sort({ _id: -1 })
      .limit(filter.limit + 1)
      .lean<ContactDocument[]>();
    return toPage(rows, filter.limit, toContact);
  }

  async findContact(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactRecord | null> {
    const _id = objectId(contactId);
    if (!_id) return null;
    const doc = await this.contacts
      .findOne({ workspaceId, _id })
      .lean<ContactDocument>();
    return doc ? toContact(doc) : null;
  }

  async existingContactIds(
    workspaceId: string,
    contactIds: readonly string[],
  ): Promise<string[]> {
    const ids = contactIds.flatMap((id) => objectId(id) ?? []);
    if (ids.length === 0) return [];
    const rows = await this.contacts
      .find({ workspaceId, _id: { $in: ids } }, { _id: 1 })
      .lean<Pick<ContactDocument, '_id'>[]>();
    return rows.map((row) => row._id.toHexString());
  }

  async findContactByPhone(
    workspaceId: string,
    phone: string,
  ): Promise<ContactRecord | null> {
    const doc = await this.contacts
      .findOne({ workspaceId, phone })
      .lean<ContactDocument>();
    return doc ? toContact(doc) : null;
  }

  async createContact(
    workspaceId: string,
    data: ContactWrite,
  ): Promise<ContactRecord | 'phone_taken'> {
    try {
      const doc = await this.contacts.create({
        workspaceId,
        ...data,
        tagIds: data.tagIds.map((id) => new Types.ObjectId(id)),
      });
      return toContact(doc.toObject());
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'phone_taken';
      throw error;
    }
  }

  async updateContact(
    workspaceId: string,
    contactId: string,
    data: ContactUpdate,
  ): Promise<ContactRecord | 'phone_taken' | null> {
    const _id = objectId(contactId);
    if (!_id) return null;
    const { tagIds, fields, ...rest } = data;
    // Fields merge one by one: `fields.<key>` (keys are [a-z0-9_]).
    const fieldEntries = Object.entries(fields ?? {});
    const unset = fieldEntries.filter(([, value]) => value === null);
    try {
      const doc = await this.contacts
        .findOneAndUpdate(
          { workspaceId, _id },
          {
            $set: {
              ...rest,
              ...(tagIds && {
                tagIds: tagIds.map((id) => new Types.ObjectId(id)),
              }),
              ...Object.fromEntries(
                fieldEntries
                  .filter(([, value]) => value !== null)
                  .map(([key, value]) => [`fields.${key}`, value]),
              ),
            },
            ...(unset.length > 0 && {
              $unset: Object.fromEntries(
                unset.map(([key]) => [`fields.${key}`, '']),
              ),
            }),
          },
          { returnDocument: 'after' },
        )
        .lean<ContactDocument>();
      return doc ? toContact(doc) : null;
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'phone_taken';
      throw error;
    }
  }

  async deleteContact(
    workspaceId: string,
    contactId: string,
  ): Promise<boolean> {
    const _id = objectId(contactId);
    if (!_id) return false;
    const { deletedCount } = await this.contacts.deleteOne({
      workspaceId,
      _id,
    });
    return deletedCount === 1;
  }

  async deleteContacts(
    workspaceId: string,
    contactIds: readonly string[],
  ): Promise<string[]> {
    const ids = objectIds(contactIds);
    if (ids.length === 0) return [];
    const found = await this.contacts
      .find({ workspaceId, _id: { $in: ids } }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    const existing = found.map((doc) => doc._id);
    await this.contacts.deleteMany({ workspaceId, _id: { $in: existing } });
    return existing.map((id) => id.toHexString());
  }

  async deleteAllContacts(workspaceId: string): Promise<number> {
    const { deletedCount } = await this.contacts.deleteMany({ workspaceId });
    return deletedCount;
  }

  async bulkTags(
    workspaceId: string,
    contactIds: readonly string[],
    tagIds: readonly string[],
    mode: 'add' | 'remove',
  ): Promise<number> {
    const ids = objectIds(contactIds);
    const tags = objectIds(tagIds);
    if (ids.length === 0 || tags.length === 0) return 0;
    const { modifiedCount } = await this.contacts.updateMany(
      { workspaceId, _id: { $in: ids } },
      mode === 'add'
        ? { $addToSet: { tagIds: { $each: tags } } }
        : { $pull: { tagIds: { $in: tags } } },
    );
    return modifiedCount;
  }

  async *exportContacts(
    workspaceId: string,
    query: ContactQuery,
  ): AsyncIterable<ContactRecord> {
    const filter = contactQuery(workspaceId, query);
    if (!filter) return;
    // Pages by _id, so a long export never holds a cursor open.
    let last: Types.ObjectId | null = null;
    for (;;) {
      const rows: ContactDocument[] = await this.contacts
        .find({ ...filter, ...(last && { _id: { $lt: last } }) })
        .sort({ _id: -1 })
        .limit(EXPORT_BATCH)
        .lean<ContactDocument[]>();
      for (const row of rows) yield toContact(row);
      if (rows.length < EXPORT_BATCH) return;
      last = rows[rows.length - 1]?._id ?? null;
    }
  }

  async attendants(
    workspaceId: string,
    contactId: string,
  ): Promise<Attendant[]> {
    const rows = await this.contacts.db
      .collection<{
        lineId: string;
        status: Attendant['status'];
        assignee: { membershipId: string; name: string } | null;
      }>(CONVERSATIONS)
      .find(
        { workspaceId, contactId },
        { projection: { lineId: 1, status: 1, assignee: 1 } },
      )
      .toArray();
    return rows.map((row) => ({
      lineId: row.lineId,
      status: row.status,
      assignee: row.assignee
        ? { membershipId: row.assignee.membershipId, name: row.assignee.name }
        : null,
    }));
  }

  async unsetField(workspaceId: string, key: string): Promise<void> {
    await this.contacts.updateMany(
      { workspaceId, [`fields.${key}`]: { $exists: true } },
      { $unset: { [`fields.${key}`]: '' } },
    );
  }

  async setBlocked(
    workspaceId: string,
    contactId: string,
    block: { at: Date; by: { userId: string; name: string } } | null,
  ): Promise<ContactRecord | null> {
    if (!isValidObjectId(contactId)) return null;
    const doc = await this.contacts
      .findOneAndUpdate(
        { workspaceId, _id: new Types.ObjectId(contactId) },
        {
          $set: block
            ? { blocked: true, blockedAt: block.at, blockedBy: block.by }
            : { blocked: false, blockedAt: null, blockedBy: null },
        },
        { returnDocument: 'after' },
      )
      .lean<ContactDocument>();
    return doc ? toContact(doc) : null;
  }

  async upsertWhatsAppContact(
    workspaceId: string,
    phone: string,
    profileName: string | null,
  ): Promise<ContactRecord> {
    try {
      const doc = await this.contacts
        .findOneAndUpdate(
          { workspaceId, phone },
          {
            // workspaceId and phone come from the filter on insert.
            $setOnInsert: {
              name: profileName,
              email: null,
              notes: null,
              tagIds: [],
              source: 'whatsapp',
              lastMessageAt: null,
              createdBy: null,
            },
          },
          { upsert: true, returnDocument: 'after' },
        )
        .lean<ContactDocument>();
      if (doc.name === null && profileName) {
        await this.contacts.updateOne(
          { workspaceId, _id: doc._id, name: null },
          { $set: { name: profileName } },
        );
        return toContact({ ...doc, name: profileName });
      }
      return toContact(doc);
    } catch (error: unknown) {
      // Two webhooks raced to create the same contact: the other one won.
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.findContactByPhone(workspaceId, phone);
      if (!existing) throw error;
      return existing;
    }
  }

  async touchLastMessage(
    workspaceId: string,
    contactId: string,
    at: Date,
  ): Promise<void> {
    const _id = objectId(contactId);
    if (!_id) return;
    await this.contacts.updateOne(
      {
        workspaceId,
        _id,
        $or: [{ lastMessageAt: null }, { lastMessageAt: { $lt: at } }],
      },
      { $set: { lastMessageAt: at } },
    );
  }

  countActiveSince(workspaceId: string, since: Date): Promise<number> {
    return this.contacts.countDocuments({
      workspaceId,
      lastMessageAt: { $gte: since },
    });
  }

  // ─────────────────────────── Tags ───────────────────────────

  async listTags(workspaceId: string): Promise<TagRecord[]> {
    const docs = await this.tags
      .find({ workspaceId })
      .sort({ normalizedName: 1 })
      .lean<TagDocument[]>();
    return docs.map(toTag);
  }

  async contactIdsWithTags(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]> {
    const ids = tagIds
      .map(objectId)
      .filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) return [];
    const docs = await this.contacts
      .find({ workspaceId, tagIds: { $in: ids } }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    return docs.map((doc) => doc._id.toHexString());
  }

  async tagIdsOf(
    workspaceId: string,
    contactIds: string[],
  ): Promise<Map<string, string[]>> {
    const ids = contactIds
      .map(objectId)
      .filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) return new Map();
    const docs = await this.contacts
      .find({ workspaceId, _id: { $in: ids } }, { _id: 1, tagIds: 1 })
      .lean<{ _id: Types.ObjectId; tagIds: Types.ObjectId[] }[]>();
    return new Map(
      docs.map((doc) => [
        doc._id.toHexString(),
        doc.tagIds.map((id) => id.toHexString()),
      ]),
    );
  }

  async countContactsByTag(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.contacts.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { workspaceId } },
      { $unwind: '$tagIds' },
      { $group: { _id: '$tagIds', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id.toHexString(), row.count]));
  }

  async existingTagIds(
    workspaceId: string,
    tagIds: string[],
  ): Promise<string[]> {
    const ids = tagIds
      .map(objectId)
      .filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) return [];
    const docs = await this.tags
      .find({ workspaceId, _id: { $in: ids } }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    return docs.map((doc) => doc._id.toHexString());
  }

  async findTag(workspaceId: string, tagId: string): Promise<TagRecord | null> {
    const _id = objectId(tagId);
    if (!_id) return null;
    const doc = await this.tags
      .findOne({ workspaceId, _id })
      .lean<TagDocument>();
    return doc ? toTag(doc) : null;
  }

  async createTag(
    workspaceId: string,
    data: TagWrite,
  ): Promise<TagRecord | 'name_taken'> {
    try {
      const doc = await this.tags.create({
        workspaceId,
        ...data,
        normalizedName: normalizeTagName(data.name),
      });
      return toTag(doc.toObject());
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'name_taken';
      throw error;
    }
  }

  async updateTag(
    workspaceId: string,
    tagId: string,
    data: Partial<TagWrite>,
  ): Promise<TagRecord | 'name_taken' | null> {
    const _id = objectId(tagId);
    if (!_id) return null;
    try {
      const doc = await this.tags
        .findOneAndUpdate(
          { workspaceId, _id },
          {
            $set: {
              ...data,
              ...(data.name !== undefined && {
                normalizedName: normalizeTagName(data.name),
              }),
            },
          },
          { returnDocument: 'after' },
        )
        .lean<TagDocument>();
      return doc ? toTag(doc) : null;
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'name_taken';
      throw error;
    }
  }

  async deleteTag(workspaceId: string, tagId: string): Promise<boolean> {
    const _id = objectId(tagId);
    if (!_id) return false;
    const { deletedCount } = await this.tags.deleteOne({ workspaceId, _id });
    if (deletedCount !== 1) return false;
    // Without replica set there are no multi-document transactions: a crash
    // here leaves a dangling id in tagIds, which reads ignore (unknown tag).
    await this.contacts.updateMany(
      { workspaceId, tagIds: _id },
      { $pull: { tagIds: _id } },
    );
    return true;
  }
}
