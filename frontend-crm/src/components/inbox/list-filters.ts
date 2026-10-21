import type { InboxFilter } from '../../lib/api/inbox'

/** Filters of the chat list; applied only with «Aplicar filtros», as in wasapi. */
export interface ListFilters {
  tagIds: string[]
  /** Membership ids; 'none' = unassigned. */
  assigneeIds: string[]
  lineId: string
  /** yyyy-mm-dd (date inputs). */
  from: string
  to: string
  sort: 'recent' | 'oldest'
}

export const NO_FILTERS: ListFilters = {
  tagIds: [],
  assigneeIds: [],
  lineId: '',
  from: '',
  to: '',
  sort: 'recent',
}

export const activeFilters = (filters: ListFilters) =>
  filters.tagIds.length +
  filters.assigneeIds.length +
  (filters.lineId ? 1 : 0) +
  (filters.from ? 1 : 0) +
  (filters.to ? 1 : 0) +
  (filters.sort !== 'recent' ? 1 : 0)

/** The applied filters as API query fields (dates as the whole local day). */
export function toQuery(filters: ListFilters): Partial<InboxFilter> {
  const day = (value: string, end: boolean) =>
    value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined
  return {
    tagIds: filters.tagIds.length ? filters.tagIds : undefined,
    assigneeIds: filters.assigneeIds.length ? filters.assigneeIds : undefined,
    lineId: filters.lineId || undefined,
    from: day(filters.from, false),
    to: day(filters.to, true),
    sort: filters.sort === 'oldest' ? 'oldest' : undefined,
  }
}
