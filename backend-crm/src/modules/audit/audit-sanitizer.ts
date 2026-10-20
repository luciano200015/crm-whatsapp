const SENSITIVE_KEY =
  /pass(word)?|token|secret|cookie|authorization|hash|credential|otp/i;
const MAX_DEPTH = 5;
const MAX_STRING = 500;

export type AuditMetadata = Record<string, unknown>;

/**
 * Defense in depth for audit metadata: drops any key that looks sensitive,
 * truncates long strings and bounds nesting, whatever the caller passes in.
 */
export function sanitizeAuditMetadata(input: AuditMetadata): AuditMetadata {
  return sanitizeObject(input, 0);
}

function sanitizeObject(input: AuditMetadata, depth: number): AuditMetadata {
  const output: AuditMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitizeValue(value, depth + 1);
  }
  return output;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeObject(value as AuditMetadata, depth);
  }
  return undefined;
}
