/** Any #RRGGBB: the UI offers a palette and a free picker. */
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
