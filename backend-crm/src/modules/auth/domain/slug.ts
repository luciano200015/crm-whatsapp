import { randomBytes } from 'node:crypto';

const MAX_BASE_LENGTH = 50;

/**
 * Turns a name into a slug matching `workspaces_slug_format_check`:
 * lowercase ASCII letters, digits and inner hyphens. Also used for the keys
 * of custom roles.
 */
export function slugify(name: string, fallback = 'workspace'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}

/** The plain slug first, then a few randomized fallbacks for collisions. */
export function slugCandidates(name: string, fallbacks = 3): string[] {
  const base = slugify(name);
  const candidates = [base];
  for (let i = 0; i < fallbacks; i++) {
    candidates.push(`${base}-${randomBytes(3).toString('hex')}`);
  }
  return candidates;
}
