import { Schema, type Types } from 'mongoose';
import { workspaceScoped } from '../../../database/mongodb/workspace-scoped.plugin';
import {
  FIELD_TYPES,
  type FieldType,
  type FieldValue,
} from '../domain/contact-fields';

export const CONTACT_MODEL = 'Contact';
export const TAG_MODEL = 'Tag';
export const CONTACT_FIELD_MODEL = 'ContactField';

export interface ContactDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  tagIds: Types.ObjectId[];
  source: 'manual' | 'whatsapp' | 'import';
  lastMessageAt: Date | null;
  blocked?: boolean;
  blockedAt?: Date | null;
  blockedBy?: { userId: string; name: string } | null;
  /** Regular agent per line («Asignación de asesores»). */
  lineAgents?: { lineId: string; membershipId: string }[];
  /** Custom field values by key. */
  fields?: Record<string, FieldValue>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  name: string;
  /** Lowercase, accent-free name: uniqueness ignores case and accents. */
  normalizedName: string;
  color: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ContactSchema = new Schema<ContactDocument>(
  {
    phone: { type: String, required: true },
    name: { type: String, default: null },
    email: { type: String, default: null },
    notes: { type: String, default: null },
    tagIds: { type: [Schema.Types.ObjectId], default: [] },
    source: {
      type: String,
      enum: ['manual', 'whatsapp', 'import'],
      required: true,
    },
    lastMessageAt: { type: Date, default: null },
    blocked: { type: Boolean, default: false },
    blockedAt: { type: Date, default: null },
    blockedBy: {
      type: new Schema(
        {
          userId: { type: String, required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    lineAgents: {
      type: [
        new Schema(
          {
            lineId: { type: String, required: true },
            membershipId: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Keys are validated against contact_fields before writing.
    fields: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: null },
  },
  { collection: 'contacts', timestamps: true, versionKey: false },
);
ContactSchema.plugin(workspaceScoped);
ContactSchema.index({ workspaceId: 1, phone: 1 }, { unique: true });
ContactSchema.index({ workspaceId: 1, tagIds: 1, _id: -1 });
ContactSchema.index({ workspaceId: 1, _id: -1 });
ContactSchema.index({ workspaceId: 1, lastMessageAt: -1 });
ContactSchema.index({ workspaceId: 1, blocked: 1, _id: -1 });

export interface ContactFieldDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const ContactFieldSchema = new Schema<ContactFieldDocument>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: FIELD_TYPES, required: true },
    options: { type: [String], default: [] },
  },
  { collection: 'contact_fields', timestamps: true, versionKey: false },
);
ContactFieldSchema.plugin(workspaceScoped);
ContactFieldSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const TagSchema = new Schema<TagDocument>(
  {
    name: { type: String, required: true },
    normalizedName: { type: String, required: true },
    color: { type: String, required: true },
    description: { type: String, default: null },
  },
  { collection: 'tags', timestamps: true, versionKey: false },
);
TagSchema.plugin(workspaceScoped);
TagSchema.index({ workspaceId: 1, normalizedName: 1 }, { unique: true });
