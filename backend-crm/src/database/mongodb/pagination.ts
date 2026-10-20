import { isValidObjectId, Types } from 'mongoose';

/** Page size bounds shared by every cursor-paginated list. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface CursorPage<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null when there are no more. */
  nextCursor: string | null;
}

/**
 * Newest-first pagination by `_id` (ObjectIds grow with time). Returns the
 * extra filter for the page after `cursor`; an invalid cursor is ignored.
 */
export function afterCursor(cursor: string | undefined): {
  _id?: { $lt: Types.ObjectId };
} {
  return cursor && isValidObjectId(cursor)
    ? { _id: { $lt: new Types.ObjectId(cursor) } }
    : {};
}

/** Fetch `limit + 1` rows, then call this to build the page. */
export function toPage<T extends { _id: Types.ObjectId }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): CursorPage<R> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor: rows.length > limit && last ? last._id.toHexString() : null,
  };
}

/** Escapes user input for use inside a RegExp (search boxes). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
