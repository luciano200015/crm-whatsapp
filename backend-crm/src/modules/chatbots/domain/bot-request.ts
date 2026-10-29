import type { NodeData } from './flow';

/** The HTTP request of a «Consulta API», with its variables filled in. */
export interface BotRequest {
  method: NodeData['api']['method'];
  url: string;
  headers: Record<string, string>;
  /** JSON body (every method but GET). */
  body: string | null;
}

/** What the external service answered. */
export interface BotResponse {
  /** A 2xx answer. */
  ok: boolean;
  /** 0 when there was no answer (blocked address, timeout, too large…). */
  status: number;
  /** The JSON answer, or its text when it is not JSON. */
  body: unknown;
  /** Why it failed, for the editor's «Probar conexión». */
  error?: string;
}

/** Values saved from an answer are cut here. */
export const MAX_SAVED_VALUE = 500;

// A header value cannot break into another header.
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

/**
 * Builds the request of a «Consulta API». `fill` replaces the {{variables}};
 * in the URL their values are URL-encoded.
 */
export function buildRequest(
  data: NodeData['api'],
  fill: (text: string, encode?: (value: string) => string) => string,
): BotRequest {
  const headers: Record<string, string> = {};
  for (const header of data.headers) {
    const key = oneLine(header.key);
    if (key) headers[key] = oneLine(fill(header.value));
  }
  if (data.auth.type === 'bearer')
    headers.Authorization = `Bearer ${oneLine(fill(data.auth.token))}`;
  if (data.auth.type === 'basic')
    headers.Authorization = `Basic ${Buffer.from(
      `${fill(data.auth.user)}:${fill(data.auth.password)}`,
    ).toString('base64')}`;
  const params = data.params
    .filter((param) => param.key.trim())
    .map((param) => [param.key.trim(), fill(param.value)] as const);
  let url = fill(data.url.trim(), encodeURIComponent);
  let body: string | null = null;
  if (data.method === 'GET') {
    if (params.length > 0) {
      const query = new URLSearchParams(params.map(([k, v]) => [k, v]));
      url += `${url.includes('?') ? '&' : '?'}${query.toString()}`;
    }
  } else {
    body = JSON.stringify(Object.fromEntries(params));
    headers['Content-Type'] = 'application/json';
  }
  return { method: data.method, url, headers, body };
}

/**
 * The value at a path of a JSON answer («data.items[0].nombre» or
 * «data.items.0.nombre»), as text: objects as JSON, nothing as ''.
 */
export function valueAt(body: unknown, path: string): string {
  const keys = path
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = body;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) return '';
  const text =
    typeof current === 'string'
      ? current
      : typeof current === 'number' || typeof current === 'boolean'
        ? String(current)
        : (JSON.stringify(current) ?? '');
  return text.slice(0, MAX_SAVED_VALUE);
}
