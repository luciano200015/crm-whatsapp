import type { mongo } from 'mongoose';

/** The fields of a conversation that merging reads and rewrites. */
export interface MergeRow {
  _id: mongo.ObjectId;
  workspaceId: string;
  lineId: string;
  contactId: string;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  assignee: unknown;
  lastMessage: unknown;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  unreadCount: number;
  closedAt: Date | null;
  createdAt: Date;
}

export interface MergeCollections {
  conversations: mongo.Collection<MergeRow>;
  messages: mongo.Collection;
}

export interface AdoptResult {
  /** The chats that now belong to the contact, one per line. */
  keptIds: mongo.ObjectId[];
  /** Chats emptied into another one and deleted. */
  removedIds: mongo.ObjectId[];
  /** Messages moved from a deleted chat to the one kept. */
  movedMessages: number;
}

// The merged chat keeps the most "alive" status: open, then on hold, then closed.
const RANK = { OPEN: 0, ON_HOLD: 1, CLOSED: 2 } as const;

const newestFirst = (a: MergeRow, b: MergeRow) =>
  b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
  b._id.toHexString().localeCompare(a._id.toHexString());

/**
 * Gives a contact the chats left behind by deleted contacts with its phone
 * (`orphans`). Per line, the contact's own chat is kept (else the most recent
 * orphan): the other chats move their messages into it and are deleted, so
 * no message is lost and the contact keeps one chat per line.
 */
export async function adoptConversations(
  { conversations, messages }: MergeCollections,
  workspaceId: string,
  target: {
    contactId: string;
    contact: { name: string | null; phone: string };
  },
  orphanContactIds: readonly string[],
): Promise<AdoptResult> {
  const result: AdoptResult = { keptIds: [], removedIds: [], movedMessages: 0 };
  if (orphanContactIds.length === 0) return result;
  const orphans = await conversations
    .find({
      workspaceId,
      contactId: { $in: [...orphanContactIds] },
      'contact.phone': target.contact.phone,
    })
    .toArray();
  if (orphans.length === 0) return result;
  const lineIds = [...new Set(orphans.map((row) => row.lineId))];
  const own = await conversations
    .find({
      workspaceId,
      contactId: target.contactId,
      lineId: { $in: lineIds },
    })
    .toArray();

  for (const lineId of lineIds) {
    const rows = [...own, ...orphans]
      .filter((row) => row.lineId === lineId)
      .sort(newestFirst);
    const keep =
      rows.find((row) => row.contactId === target.contactId) ?? rows[0];
    if (!keep) continue;
    const others = rows.filter((row) => row !== keep);
    const otherIds = others.map((row) => row._id);
    const newest = rows[0] ?? keep;
    const state =
      [...rows].sort((a, b) => RANK[a.status] - RANK[b.status])[0] ?? keep;
    const inbound = Math.max(
      0,
      ...rows.map((row) => row.lastInboundAt?.getTime() ?? 0),
    );

    if (otherIds.length > 0) {
      const moved = await messages.updateMany(
        { workspaceId, conversationId: { $in: otherIds } },
        { $set: { conversationId: keep._id } },
      );
      result.movedMessages += moved.modifiedCount;
      // Deleted before the kept chat takes the contact: one chat per contact and line.
      await conversations.deleteMany({ workspaceId, _id: { $in: otherIds } });
      result.removedIds.push(...otherIds);
    }
    await conversations.updateOne(
      { workspaceId, _id: keep._id },
      {
        $set: {
          contactId: target.contactId,
          contact: target.contact,
          status: state.status,
          assignee: state.assignee ?? null,
          closedAt: state.status === 'CLOSED' ? state.closedAt : null,
          lastMessage: newest.lastMessage ?? null,
          lastActivityAt: newest.lastActivityAt,
          lastInboundAt: inbound ? new Date(inbound) : null,
          unreadCount: rows.reduce(
            (sum, row) => sum + (row.unreadCount ?? 0),
            0,
          ),
          createdAt: rows.reduce(
            (first, row) => (row.createdAt < first ? row.createdAt : first),
            keep.createdAt,
          ),
        },
      },
    );
    result.keptIds.push(keep._id);
  }
  return result;
}
