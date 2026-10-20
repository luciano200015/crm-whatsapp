import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types, type Model } from 'mongoose';
import {
  afterCursor,
  escapeRegex,
  toPage,
  type CursorPage,
} from '../../../database/mongodb/pagination';
import {
  ContactsStore,
  type ContactFilter,
  type ContactRecord,
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
    const search = filter.search?.trim();
    const tagId = filter.tagId ? objectId(filter.tagId) : undefined;
    if (filter.tagId && !tagId) return { items: [], nextCursor: null };

    const pattern = search ? new RegExp(escapeRegex(search), 'i') : null;
    const digits = search?.replace(/\D/g, '');
    const rows = await this.contacts
      .find({
        workspaceId,
        ...afterCursor(filter.cursor),
        ...(tagId && { tagIds: tagId }),
        ...(pattern && {
          $or: [
            { name: pattern },
            { email: pattern },
            ...(digits ? [{ phone: new RegExp(escapeRegex(digits)) }] : []),
          ],
        }),
      })
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
    data: Partial<Omit<ContactWrite, 'source' | 'createdBy'>>,
  ): Promise<ContactRecord | 'phone_taken' | null> {
    const _id = objectId(contactId);
    if (!_id) return null;
    const { tagIds, ...rest } = data;
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
            },
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
