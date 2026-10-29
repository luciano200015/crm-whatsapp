/**
 * Variables of a chatbot: the contact's data (always there) and the ones
 * created for the bot (text, number or yes/no). Texts use them as
 * {{nombre}}; "Guardar respuesta" fills them and conditions compare them.
 */
export const VARIABLE_TYPES = ['text', 'number', 'boolean'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface BotVariable {
  name: string;
  type: VariableType;
  /** What it holds until an answer is saved ('' none; 'true'/'false' for yes/no). */
  defaultValue: string;
  description: string;
}

export const MAX_VARIABLES = 50;
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;

/** Contact data every chatbot can read. */
export const CONTACT_VARIABLES = [
  'nombre',
  'apellido',
  'nombre_completo',
  'email',
  'telefono',
] as const;

/** Reserved in texts: who got the chat after a transfer. */
const RESERVED = new Set<string>([...CONTACT_VARIABLES, 'agente']);

export interface VariableContact {
  name: string | null;
  phone: string;
  email: string | null;
  /** Custom fields of the contact, by key: {{campo_<key>}}. */
  fields?: Record<string, unknown>;
}

/** Prefix of the custom fields of the contact in texts: {{campo_cedula}}. */
export const FIELD_PREFIX = 'campo_';

/** {{nombre}}, {{apellido}}, {{campo_…}}… of a contact. */
export function contactValues(
  contact: VariableContact,
): Record<string, string> {
  const full = (contact.name ?? '').trim().replace(/\s+/g, ' ');
  const [first = '', ...rest] = full ? full.split(' ') : [];
  const fields = Object.fromEntries(
    Object.entries(contact.fields ?? {}).flatMap(([key, value]) =>
      typeof value === 'string' || typeof value === 'number'
        ? [[`${FIELD_PREFIX}${key}`, String(value)]]
        : [],
    ),
  );
  return {
    ...fields,
    nombre: first,
    apellido: rest.join(' '),
    nombre_completo: full,
    email: contact.email ?? '',
    telefono: contact.phone,
  };
}

const TRUE = new Set(['si', 'sí', 'yes', 'true', '1', 'verdadero', 's', 'y']);
const FALSE = new Set(['no', 'false', '0', 'falso', 'n']);

/** 'true' / 'false' from what a customer writes ("sí", "no"…), or null. */
export function booleanValue(text: string): 'true' | 'false' | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[.!¡¿?]/g, '');
  if (TRUE.has(value)) return 'true';
  if (FALSE.has(value)) return 'false';
  return null;
}

const NUMBER = /^-?\d+([.,]\d+)?$/;
export const isNumber = (text: string) => NUMBER.test(text.trim());
export const toNumber = (text: string) =>
  isNumber(text) ? Number(text.trim().replace(',', '.')) : null;

/** Why the variables sent by the editor are wrong, or the variables. */
export function parseVariables(
  value: unknown,
): { variables: BotVariable[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: 'Variables inválidas' };
  if (value.length > MAX_VARIABLES)
    return { problem: `Máximo ${MAX_VARIABLES} variables` };
  const seen = new Set<string>();
  const variables: BotVariable[] = [];
  for (const item of value as unknown[]) {
    const raw = (
      typeof item === 'object' && item !== null ? item : {}
    ) as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!VARIABLE_NAME.test(name))
      return {
        problem: `«${name}»: usa letras, números y _ (sin espacios, máximo 31)`,
      };
    const key = name.toLowerCase();
    if (RESERVED.has(key))
      return { problem: `«${name}» ya existe como dato del contacto` };
    if (seen.has(key)) return { problem: `«${name}» está repetida` };
    seen.add(key);
    const type = (VARIABLE_TYPES as readonly unknown[]).includes(raw.type)
      ? (raw.type as VariableType)
      : null;
    if (!type) return { problem: `«${name}»: tipo inválido` };
    const given =
      typeof raw.defaultValue === 'string' ? raw.defaultValue.trim() : '';
    let defaultValue = given.slice(0, 500);
    if (type === 'number' && given && !isNumber(given))
      return { problem: `«${name}»: el valor por defecto debe ser un número` };
    if (type === 'boolean') {
      const parsed = given ? booleanValue(given) : 'false';
      if (!parsed)
        return { problem: `«${name}»: el valor por defecto debe ser sí o no` };
      defaultValue = parsed;
    }
    const description =
      typeof raw.description === 'string'
        ? raw.description.trim().slice(0, 200)
        : '';
    variables.push({ name, type, defaultValue, description });
  }
  return { variables };
}

/** Stored variables; anything unreadable is dropped. */
export function storedVariables(value: unknown): BotVariable[] {
  const parsed = parseVariables(value);
  return 'variables' in parsed ? parsed.variables : [];
}
