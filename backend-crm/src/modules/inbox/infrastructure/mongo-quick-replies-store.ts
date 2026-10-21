import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Schema, Types, type Model } from 'mongoose';
import { workspaceScoped } from '../../../database/mongodb/workspace-scoped.plugin';
import {
  QuickRepliesStore,
  type QuickReplyRecord,
} from '../application/quick-replies';

export const QUICK_REPLY_MODEL = 'QuickReply';

interface QuickReplyDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  shortcut: string;
  text: string;
  createdBy: { userId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export const QuickReplySchema = new Schema<QuickReplyDocument>(
  {
    shortcut: { type: String, required: true },
    text: { type: String, required: true },
    createdBy: {
      type: new Schema(
        {
          userId: { type: String, required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { collection: 'quick_replies', timestamps: true, versionKey: false },
);
QuickReplySchema.plugin(workspaceScoped);
QuickReplySchema.index({ workspaceId: 1, shortcut: 1 }, { unique: true });

const DUPLICATE_KEY = 11000;
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === DUPLICATE_KEY;

function toRecord(doc: QuickReplyDocument): QuickReplyRecord {
  return {
    id: doc._id.toHexString(),
    shortcut: doc.shortcut,
    text: doc.text,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoQuickRepliesStore
  extends QuickRepliesStore
  implements OnModuleInit
{
  constructor(
    @InjectModel(QUICK_REPLY_MODEL)
    private readonly replies: Model<QuickReplyDocument>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.replies.createIndexes();
  }

  async list(workspaceId: string): Promise<QuickReplyRecord[]> {
    const rows = await this.replies
      .find({ workspaceId })
      .sort({ shortcut: 1 })
      .lean<QuickReplyDocument[]>();
    return rows.map(toRecord);
  }

  async create(
    workspaceId: string,
    data: {
      shortcut: string;
      text: string;
      createdBy: { userId: string; name: string };
    },
  ): Promise<QuickReplyRecord | 'shortcut_taken'> {
    try {
      const doc = await this.replies.create({ workspaceId, ...data });
      return toRecord(doc.toObject());
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'shortcut_taken';
      throw error;
    }
  }

  async update(
    workspaceId: string,
    id: string,
    data: { shortcut?: string; text?: string },
  ): Promise<QuickReplyRecord | 'shortcut_taken' | null> {
    if (!isValidObjectId(id)) return null;
    try {
      const doc = await this.replies
        .findOneAndUpdate(
          { workspaceId, _id: new Types.ObjectId(id) },
          { $set: data },
          { returnDocument: 'after' },
        )
        .lean<QuickReplyDocument>();
      return doc ? toRecord(doc) : null;
    } catch (error: unknown) {
      if (isDuplicateKey(error)) return 'shortcut_taken';
      throw error;
    }
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const result = await this.replies.deleteOne({
      workspaceId,
      _id: new Types.ObjectId(id),
    });
    return result.deletedCount === 1;
  }
}
