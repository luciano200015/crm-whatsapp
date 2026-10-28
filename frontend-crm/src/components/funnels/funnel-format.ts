import type { BoardFilters, Lead } from '../../lib/api/funnels'

/** "$ 1.250,50": the value is only informative, always in $. */
export function formatMoney(cents: number): string {
  return `$ ${(cents / 100).toLocaleString('es', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** "1250,5" or "1250.50" → 125050 cents; '' → null; anything else → NaN. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/\s|\$/g, '')
  if (!clean) return null
  // One separator is the decimal one when 1 or 2 digits follow it.
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(clean)
  if (!match) return Number.NaN
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** Cents as the field shows them: "1250.50". */
export const moneyInput = (cents: number) => (cents / 100).toFixed(2)

export const leadName = (lead: Pick<Lead, 'contact'>) =>
  lead.contact?.name ?? lead.contact?.phone ?? 'Contacto'

/** Leads whose chat is another agent's show no preview and do not open. */
export const canOpen = (lead: Lead) => lead.conversation?.visible !== false

/** How many filters are in use (the badge of «Filtros»). Search and order are not. */
export function activeFilters(filters: BoardFilters): number {
  return (
    filters.agentIds.length +
    (filters.unassigned ? 1 : 0) +
    filters.tagIds.length +
    filters.statuses.length +
    (filters.archived ? 1 : 0) +
    (filters.minCents !== null ? 1 : 0) +
    (filters.maxCents !== null ? 1 : 0)
  )
}
