import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta signs every webhook with the app's App Secret:
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`.
 * Compared in constant time; any malformed header is simply invalid.
 */
export function isValidSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/** Signs a body like Meta does (used by tests and the local simulator). */
export function signBody(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Constant-time comparison of the webhook verify token. */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
