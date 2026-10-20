/** Tag colors offered by the UI (any #RRGGBB is accepted). */
export const TAG_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
] as const;

export const TAG_COLOR_FORMAT = /^#[0-9a-f]{6}$/i;

/** "VIP ", "vip" and "Vïp" are the same tag. */
export function normalizeTagName(name: string): string {
  return name
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
