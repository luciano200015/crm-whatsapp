import { Schema, type Types } from 'mongoose';
import { workspaceScoped } from '../../../database/mongodb/workspace-scoped.plugin';

export const FUNNEL_LEAD_MODEL = 'FunnelLead';

/**
 * A contact in a funnel (PostgreSQL `funnels`): its stage and value there.
 * One per contact and funnel. It sits next to contacts and conversations so
 * the board filters by name, tags, chat status and agent in one query.
 */
export interface FunnelLeadDocument {
  _id: Types.ObjectId;
  workspaceId: string;
  funnelId: string;
  /** Line of the funnel: the chat of the lead is (lineId, contactId). */
  lineId: string;
  stageId: string;
  contactId: string;
  /** Expected value in cents ("Valor"); 0 when not set. */
  amountCents: number;
  archivedAt: Date | null;
  /** Who archived it; null with archivedAt set: archived for inactivity. */
  archivedBy: { userId: string; name: string } | null;
  /** Last message of the chat (or when it joined): auto-archive counts from here. */
  activityAt: Date;
  /** Grows with every change: a write with an older version is rejected. */
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const FunnelLeadSchema = new Schema<FunnelLeadDocument>(
  {
    funnelId: { type: String, required: true },
    lineId: { type: String, required: true },
    stageId: { type: String, required: true },
    contactId: { type: String, required: true },
    amountCents: { type: Number, default: 0, min: 0 },
    archivedAt: { type: Date, default: null },
    archivedBy: {
      type: new Schema(
        {
          userId: { type: String, required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    activityAt: { type: Date, required: true },
    version: { type: Number, default: 1 },
    createdBy: { type: String, default: null },
  },
  { collection: 'funnel_leads', timestamps: true, versionKey: false },
);
FunnelLeadSchema.plugin(workspaceScoped);

// One lead per contact and funnel, even when two requests race.
FunnelLeadSchema.index(
  { workspaceId: 1, funnelId: 1, contactId: 1 },
  { unique: true, name: 'one_lead_per_funnel' },
);
FunnelLeadSchema.index({
  workspaceId: 1,
  funnelId: 1,
  stageId: 1,
  archivedAt: 1,
  activityAt: -1,
});
FunnelLeadSchema.index({ workspaceId: 1, contactId: 1 });
FunnelLeadSchema.index({ workspaceId: 1, lineId: 1, contactId: 1 });
