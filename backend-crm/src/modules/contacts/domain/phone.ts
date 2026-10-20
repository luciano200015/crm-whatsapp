import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalizes a phone number to E.164 (+59171234567). Accepts international
 * input with or without "+" (WhatsApp sends "59171234567"), spaces, dashes
 * and parentheses. Returns null when it cannot be a real number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPlus = trimmed.startsWith('+')
    ? trimmed
    : `+${trimmed.replace(/^00/, '')}`;
  const parsed = parsePhoneNumberFromString(withPlus);
  if (!parsed?.isPossible()) return null;
  return parsed.number;
}

/** Digits only, as WhatsApp's `wa_id` and the Cloud API `to` field expect. */
export function toWhatsAppId(e164: string): string {
  return e164.replace(/^\+/, '');
}
