import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  isValidObjectId,
  Types,
  type Model,
  type ModifyResult,
  type PipelineStage,
} from 'mongoose';
import { escapeRegex } from '../../../database/mongodb/pagination';
import {
  LeadsStore,
  type BoardScope,
  type LeadCard,
  type LeadRecord,
  type LeadWrite,
  type StageColumn,
} from '../application/ports';
import type { BoardFilters, ChatStatus } from '../domain/funnel-rules';
import {
  FUNNEL_LEAD_MODEL,
  type FunnelLeadDocument,
} from './funnel-lead.schemas';

const DUPLICATE_KEY = 11000;

// Collections of the contacts and inbox modules, joined by the board.
const CONTACTS = 'contacts';
const CONVERSATIONS = 'conversations';

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
  ids.flatMap((id) => objectId(id) ?? []);

function toLead(doc: FunnelLeadDocument): LeadRecord {
  return {
    id: doc._id.toHexString(),
    funnelId: doc.funnelId,
    lineId: doc.lineId,
    stageId: doc.stageId,
    contactId: doc.contactId,
    amountCents: doc.amountCents,
    archivedAt: doc.archivedAt,
    archivedBy: doc.archivedBy ?? null,
    activityAt: doc.activityAt,
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

interface CardRow extends FunnelLeadDocument {
  contact?: { name: string | null; phone: string; tagIds: Types.ObjectId[] };
  conversation?: {
    _id: Types.ObjectId;
    status: ChatStatus;
    assignee: { membershipId: string; userId: string; name: string } | null;
    lastMessage: {
      text?: string | null;
      type: string;
      direction: string;
      at: Date;
    } | null;
    unreadCount: number;
    lastActivityAt: Date;
  };
}

function toCard(row: CardRow): LeadCard {
  const { contact, conversation } = row;
  return {
    ...toLead(row),
    contact: contact
      ? {
          name: contact.name ?? null,
          phone: contact.phone,
          tagIds: (contact.tagIds ?? []).map((id) => id.toHexString()),
        }
      : null,
    conversation: conversation
      ? {
          id: conversation._id.toHexString(),
          status: conversation.status,
          assignee: conversation.assignee ?? null,
          lastMessage: conversation.lastMessage
            ? {
                text: conversation.lastMessage.text ?? null,
                type: conversation.lastMessage.type,
                direction: conversation.lastMessage.direction,
                at: conversation.lastMessage.at,
              }
            : null,
          unreadCount: conversation.unreadCount ?? 0,
          lastActivityAt: conversation.lastActivityAt,
        }
      : null,
  };
}

const SORTS = {
  recent: { activityAt: -1, _id: -1 },
  value_desc: { amountCents: -1, _id: -1 },
  value_asc: { amountCents: 1, _id: 1 },
} as const;

@Injectable()
export class MongoLeadsStore extends LeadsStore implements OnModuleInit {
  constructor(
    @InjectModel(FUNNEL_LEAD_MODEL)
    private readonly leads: Model<FunnelLeadDocument>,
  ) {
    super();
  }

  /** The unique index must exist before the first write (autoIndex is off). */
  async onModuleInit(): Promise<void> {
    await this.leads.createIndexes();
  }

  async find(workspaceId: string, leadId: string): Promise<LeadRecord | null> {
    const _id = objectId(leadId);
    if (!_id) return null;
    const doc = await this.leads
      .findOne({ workspaceId, _id })
      .lean<FunnelLeadDocument>();
    return doc ? toLead(doc) : null;
  }

  async findByContact(
    workspaceId: string,
    funnelId: string,
    contactId: string,
  ): Promise<LeadRecord | null> {
    const doc = await this.leads
      .findOne({ workspaceId, funnelId, contactId })
      .lean<FunnelLeadDocument>();
    return doc ? toLead(doc) : null;
  }

  async ofContact(
    workspaceId: string,
    contactId: string,
  ): Promise<LeadRecord[]> {
    const docs = await this.leads
      .find({ workspaceId, contactId })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean<FunnelLeadDocument[]>();
    return docs.map(toLead);
  }

  async insert(
    workspaceId: string,
    input: {
      funnelId: string;
      lineId: string;
      stageId: string;
      contactId: string;
      activityAt: Date;
      createdBy: string | null;
    },
  ): Promise<{ lead: LeadRecord; created: boolean }> {
    const filter = {
      workspaceId,
      funnelId: input.funnelId,
      contactId: input.contactId,
    };
    const upsert = () =>
      this.leads
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              lineId: input.lineId,
              stageId: input.stageId,
              amountCents: 0,
              archivedAt: null,
              archivedBy: null,
              activityAt: input.activityAt,
              version: 1,
              createdBy: input.createdBy,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            includeResultMetadata: true,
          },
        )
        .lean<ModifyResult<FunnelLeadDocument>>();
    let result;
    try {
      result = await upsert();
    } catch (error) {
      // Two upserts raced: the other one inserted it.
      if (!isDuplicateKey(error)) throw error;
      result = await upsert();
    }
    const doc = result.value;
    if (!doc) throw new Error('Upsert returned no lead');
    return {
      lead: toLead(doc),
      created: !result.lastErrorObject?.updatedExisting,
    };
  }

  private async write(
    workspaceId: string,
    leadId: string,
    set: Record<string, unknown>,
    version?: number,
  ): Promise<LeadWrite> {
    const _id = objectId(leadId);
    if (!_id) return null;
    const doc = await this.leads
      .findOneAndUpdate(
        { workspaceId, _id, ...(version !== undefined && { version }) },
        { $set: set, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean<FunnelLeadDocument>();
    if (doc) return toLead(doc);
    if (version === undefined) return null;
    return (await this.find(workspaceId, leadId)) ? 'changed' : null;
  }

  move(
    workspaceId: string,
    leadId: string,
    stageId: string,
    version?: number,
  ): Promise<LeadWrite> {
    return this.write(workspaceId, leadId, { stageId }, version);
  }

  setAmount(
    workspaceId: string,
    leadId: string,
    amountCents: number,
    version?: number,
  ): Promise<LeadWrite> {
    return this.write(workspaceId, leadId, { amountCents }, version);
  }

  async setArchived(
    workspaceId: string,
    leadId: string,
    archived: { at: Date; by: { userId: string; name: string } | null } | null,
  ): Promise<LeadRecord | null> {
    const result = await this.write(workspaceId, leadId, {
      archivedAt: archived?.at ?? null,
      archivedBy: archived?.by ?? null,
    });
    return result === 'changed' ? null : result;
  }

  async remove(workspaceId: string, leadId: string): Promise<boolean> {
    const _id = objectId(leadId);
    if (!_id) return false;
    const { deletedCount } = await this.leads.deleteOne({ workspaceId, _id });
    return deletedCount > 0;
  }

  async existing(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    stageIds: readonly string[],
  ): Promise<LeadRecord[]> {
    const docs = await this.leads
      .find({
        workspaceId,
        funnelId,
        _id: { $in: objectIds(leadIds) },
        stageId: { $in: [...stageIds] },
      })
      .lean<FunnelLeadDocument[]>();
    return docs.map(toLead);
  }

  async moveMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    stageId: string,
  ): Promise<number> {
    const { modifiedCount } = await this.leads.updateMany(
      { workspaceId, funnelId, _id: { $in: objectIds(leadIds) } },
      { $set: { stageId }, $inc: { version: 1 } },
    );
    return modifiedCount;
  }

  async archiveMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
    archived: { at: Date; by: { userId: string; name: string } } | null,
  ): Promise<number> {
    const { modifiedCount } = await this.leads.updateMany(
      { workspaceId, funnelId, _id: { $in: objectIds(leadIds) } },
      {
        $set: {
          archivedAt: archived?.at ?? null,
          archivedBy: archived?.by ?? null,
        },
        $inc: { version: 1 },
      },
    );
    return modifiedCount;
  }

  async removeMany(
    workspaceId: string,
    funnelId: string,
    leadIds: readonly string[],
  ): Promise<number> {
    const { deletedCount } = await this.leads.deleteMany({
      workspaceId,
      funnelId,
      _id: { $in: objectIds(leadIds) },
    });
    return deletedCount;
  }

  async moveStage(
    workspaceId: string,
    funnelId: string,
    fromStageId: string,
    toStageId: string,
  ): Promise<number> {
    const { modifiedCount } = await this.leads.updateMany(
      { workspaceId, funnelId, stageId: fromStageId },
      { $set: { stageId: toStageId }, $inc: { version: 1 } },
    );
    return modifiedCount;
  }

  countStage(
    workspaceId: string,
    funnelId: string,
    stageId: string,
  ): Promise<number> {
    return this.leads.countDocuments({ workspaceId, funnelId, stageId });
  }

  async countByFunnel(
    workspaceId: string,
    funnelIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (funnelIds.length === 0) return new Map();
    const rows = await this.leads.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          workspaceId,
          funnelId: { $in: [...funnelIds] },
          archivedAt: null,
        },
      },
      { $group: { _id: '$funnelId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id, row.count]));
  }

  countFunnel(workspaceId: string, funnelId: string): Promise<number> {
    return this.leads.countDocuments({ workspaceId, funnelId });
  }

  async removeFunnel(workspaceId: string, funnelId: string): Promise<number> {
    const { deletedCount } = await this.leads.deleteMany({
      workspaceId,
      funnelId,
    });
    return deletedCount;
  }

  async removeContacts(
    workspaceId: string,
    contactIds: readonly string[] | 'all',
  ): Promise<string[]> {
    const filter = {
      workspaceId,
      ...(contactIds !== 'all' && { contactId: { $in: [...contactIds] } }),
    };
    const funnelIds = await this.leads.distinct('funnelId', filter);
    if (funnelIds.length > 0) await this.leads.deleteMany(filter);
    return funnelIds.map(String);
  }

  /**
   * Leads of the scope joined with their contact and their chat on the
   * funnel's line, then filtered. Both joins are scoped to the workspace.
   */
  private cards(
    workspaceId: string,
    scope: BoardScope,
    filters: BoardFilters,
  ): PipelineStage[] {
    const search = filters.search?.trim();
    const digits = search?.replace(/\D/g, '');
    const tagIds = objectIds(filters.tagIds ?? []);
    const agents = filters.agentIds ?? [];
    const amount = {
      ...(filters.minCents !== undefined && { $gte: filters.minCents }),
      ...(filters.maxCents !== undefined && { $lte: filters.maxCents }),
    };
    const after: Record<string, unknown>[] = [
      ...(search
        ? [
            {
              $or: [
                { 'contact.name': new RegExp(escapeRegex(search), 'i') },
                ...(digits
                  ? [{ 'contact.phone': new RegExp(escapeRegex(digits)) }]
                  : []),
              ],
            },
          ]
        : []),
      ...(tagIds.length > 0 ? [{ 'contact.tagIds': { $in: tagIds } }] : []),
      ...(filters.statuses?.length
        ? [{ 'conversation.status': { $in: filters.statuses } }]
        : []),
      ...(agents.length > 0 || filters.unassigned
        ? [
            {
              $or: [
                ...(agents.length > 0
                  ? [{ 'conversation.assignee.membershipId': { $in: agents } }]
                  : []),
                // No agent: unassigned chat, or no chat on this line yet.
                ...(filters.unassigned
                  ? [{ 'conversation.assignee': null }]
                  : []),
              ],
            },
          ]
        : []),
    ];
    return [
      {
        $match: {
          workspaceId,
          funnelId: scope.funnelId,
          stageId: { $in: scope.stageIds },
          archivedAt: filters.archived ? { $ne: null } : null,
          ...(Object.keys(amount).length > 0 && { amountCents: amount }),
        },
      },
      {
        $lookup: {
          from: CONTACTS,
          let: { contactId: { $toObjectId: '$contactId' } },
          pipeline: [
            {
              $match: {
                workspaceId,
                $expr: { $eq: ['$_id', '$$contactId'] },
              },
            },
            { $project: { name: 1, phone: 1, tagIds: 1 } },
          ],
          as: 'contact',
        },
      },
      {
        $lookup: {
          from: CONVERSATIONS,
          localField: 'contactId',
          foreignField: 'contactId',
          pipeline: [
            { $match: { workspaceId, lineId: scope.lineId } },
            {
              $project: {
                status: 1,
                assignee: 1,
                lastMessage: 1,
                unreadCount: 1,
                lastActivityAt: 1,
              },
            },
          ],
          as: 'conversation',
        },
      },
      {
        $set: {
          contact: { $first: '$contact' },
          conversation: { $first: '$conversation' },
        },
      },
      ...(after.length > 0 ? [{ $match: { $and: after } }] : []),
    ];
  }

  async board(
    workspaceId: string,
    scope: BoardScope,
    filters: BoardFilters,
    pageSize: number,
  ): Promise<StageColumn[]> {
    if (scope.stageIds.length === 0) return [];
    const sort = SORTS[filters.sort ?? 'recent'];
    const columns = Object.fromEntries(
      scope.stageIds.map((stageId, index) => [
        `s${index}`,
        [{ $match: { stageId } }, { $sort: sort }, { $limit: pageSize + 1 }],
      ]),
    );
    const [result] = await this.leads.aggregate<
      Record<string, CardRow[]> & {
        totals: { _id: string; count: number; total: number }[];
      }
    >([
      ...this.cards(workspaceId, scope, filters),
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: '$stageId',
                count: { $sum: 1 },
                total: { $sum: '$amountCents' },
              },
            },
          ],
          ...columns,
        },
      },
    ]);
    const totals = new Map((result?.totals ?? []).map((row) => [row._id, row]));
    return scope.stageIds.map((stageId, index) => {
      const rows = result?.[`s${index}`] ?? [];
      return {
        stageId,
        count: totals.get(stageId)?.count ?? 0,
        totalCents: totals.get(stageId)?.total ?? 0,
        leads: rows.slice(0, pageSize).map(toCard),
        hasMore: rows.length > pageSize,
      };
    });
  }

  async page(
    workspaceId: string,
    scope: BoardScope,
    stageId: string,
    filters: BoardFilters,
    offset: number,
    limit: number,
  ): Promise<{ leads: LeadCard[]; hasMore: boolean }> {
    const rows = await this.leads.aggregate<CardRow>([
      ...this.cards(workspaceId, { ...scope, stageIds: [stageId] }, filters),
      { $sort: SORTS[filters.sort ?? 'recent'] },
      { $skip: offset },
      { $limit: limit + 1 },
    ]);
    return {
      leads: rows.slice(0, limit).map(toCard),
      hasMore: rows.length > limit,
    };
  }

  async all(
    workspaceId: string,
    scope: BoardScope,
    filters: BoardFilters,
    limit: number,
  ): Promise<LeadCard[]> {
    if (scope.stageIds.length === 0) return [];
    const rows = await this.leads.aggregate<CardRow>([
      ...this.cards(workspaceId, scope, filters),
      { $sort: SORTS[filters.sort ?? 'recent'] },
      { $limit: limit },
    ]);
    return rows.map(toCard);
  }

  async touch(
    workspaceId: string,
    lineId: string,
    contactId: string,
    at: Date,
  ): Promise<string[]> {
    const filter = { workspaceId, lineId, contactId };
    const funnelIds = (await this.leads.distinct('funnelId', filter)).map(
      String,
    );
    if (funnelIds.length === 0) return [];
    await this.leads.updateMany(filter, { $max: { activityAt: at } });
    // Archived for inactivity (nobody archived it): it is active again.
    await this.leads.updateMany(
      { ...filter, archivedAt: { $ne: null }, archivedBy: null },
      { $set: { archivedAt: null }, $inc: { version: 1 } },
    );
    return funnelIds;
  }

  async archiveIdle(
    workspaceId: string,
    funnelId: string,
    before: Date,
    at: Date,
  ): Promise<number> {
    const { modifiedCount } = await this.leads.updateMany(
      { workspaceId, funnelId, archivedAt: null, activityAt: { $lt: before } },
      { $set: { archivedAt: at, archivedBy: null }, $inc: { version: 1 } },
    );
    return modifiedCount;
  }
}
