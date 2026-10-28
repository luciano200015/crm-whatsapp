/**
 * Custom fields of contacts («Administrar campos personalizados»). The
 * workspace defines them; each contact stores its values under the field's
 * key, which never changes after creation.
 */
export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const MAX_CONTACT_FIELDS = 50;
export const MAX_FIELD_OPTIONS = 50;
export const MAX_FIELD_TEXT = 500;

/** TEXT, SELECT and DATE (YYYY-MM-DD) are strings; NUMBER is a number. */
export type FieldValue = string | number;

/** A value that does not fit the field's type. */
export const INVALID: unique symbol = Symbol('invalid');

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

/** Key for a label: lowercase ASCII, digits and «_» («Fecha de nacimiento» → fecha_de_nacimiento). */
export function fieldKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * The stored value for raw input: null when empty, INVALID when it does
 * not fit the type. Accepts what spreadsheets usually hold: «1.234,5» or
 * «1234.5» for numbers, YYYY-MM-DD or DD/MM/YYYY for dates, and any
 * capitalization of a list option.
 */
export function parseFieldValue(
  field: FieldDefinition,
  raw: unknown,
): FieldValue | null | typeof INVALID {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (field.type === 'NUMBER') return Number.isFinite(raw) ? raw : INVALID;
    raw = String(raw);
  }
  if (typeof raw !== 'string') return INVALID;
  const text = raw.trim();
  if (text === '') return null;
  switch (field.type) {
    case 'TEXT':
      return text.length <= MAX_FIELD_TEXT ? text : INVALID;
    case 'NUMBER':
      return parseNumber(text);
    case 'DATE':
      return parseDate(text);
    case 'SELECT':
      return (
        field.options.find((option) => fold(option) === fold(text)) ?? INVALID
      );
  }
}

function parseNumber(text: string): number | typeof INVALID {
  let normalized = text.replace(/\s/g, '');
  if (normalized.includes(',')) {
    // «1.234,5» (comma decimal) or «1,234.5» (comma thousands).
    normalized =
      normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return INVALID;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : INVALID;
}

function parseDate(text: string): string | typeof INVALID {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local
      ? [Number(local[3]), Number(local[2]), Number(local[1])]
      : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return INVALID;
  }
  return date.toISOString().slice(0, 10);
}

/** Options trimmed, without blanks or repeats (ignoring case and accents). */
export function cleanOptions(options: readonly string[]): string[] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const text = option.trim();
    if (!text || seen.has(fold(text))) return [];
    seen.add(fold(text));
    return [text];
  });
}
