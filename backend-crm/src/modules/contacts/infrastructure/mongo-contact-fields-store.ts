import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types, type Model } from 'mongoose';
import {
  ContactFieldsStore,
  type ContactFieldRecord,
} from '../application/ports';
import {
  CONTACT_FIELD_MODEL,
  type ContactFieldDocument,
} from './contact.schemas';

const DUPLICATE_KEY = 11000;

const toField = (doc: ContactFieldDocument): ContactFieldRecord => ({
  id: doc._id.toHexString(),
  key: doc.key,
  label: doc.label,
  type: doc.type,
  options: [...doc.options],
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

@Injectable()
export class MongoContactFieldsStore
  extends ContactFieldsStore
  implements OnModuleInit
{
  constructor(
    @InjectModel(CONTACT_FIELD_MODEL)
    private readonly fields: Model<ContactFieldDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.fields.createIndexes();
  }

  async list(workspaceId: string): Promise<ContactFieldRecord[]> {
    const docs = await this.fields
      .find({ workspaceId })
      .sort({ _id: 1 })
      .lean<ContactFieldDocument[]>();
    return docs.map(toField);
  }

  async find(
    workspaceId: string,
    fieldId: string,
  ): Promise<ContactFieldRecord | null> {
    if (!isValidObjectId(fieldId)) return null;
    const doc = await this.fields
      .findOne({ workspaceId, _id: new Types.ObjectId(fieldId) })
      .lean<ContactFieldDocument>();
    return doc ? toField(doc) : null;
  }

  async create(
    workspaceId: string,
    data: Pick<ContactFieldRecord, 'key' | 'label' | 'type' | 'options'>,
  ): Promise<ContactFieldRecord | 'key_taken'> {
    try {
      const doc = await this.fields.create({ workspaceId, ...data });
      return toField(doc.toObject());
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code === DUPLICATE_KEY) {
        return 'key_taken';
      }
      throw error;
    }
  }

  async update(
    workspaceId: string,
    fieldId: string,
    data: Partial<Pick<ContactFieldRecord, 'label' | 'options'>>,
  ): Promise<ContactFieldRecord | null> {
    if (!isValidObjectId(fieldId)) return null;
    const doc = await this.fields
      .findOneAndUpdate(
        { workspaceId, _id: new Types.ObjectId(fieldId) },
        { $set: data },
        { returnDocument: 'after' },
      )
      .lean<ContactFieldDocument>();
    return doc ? toField(doc) : null;
  }

  async remove(workspaceId: string, fieldId: string): Promise<boolean> {
    if (!isValidObjectId(fieldId)) return false;
    const { deletedCount } = await this.fields.deleteOne({
      workspaceId,
      _id: new Types.ObjectId(fieldId),
    });
    return deletedCount === 1;
  }
}
