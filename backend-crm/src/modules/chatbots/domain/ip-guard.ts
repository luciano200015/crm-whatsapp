import { isIP } from 'node:net';

/**
 * Whether a «Consulta API» may connect to an address: only public ones, so
 * a chatbot cannot reach the CRM's own network (loopback, private ranges,
 * cloud metadata, link-local, CGNAT, multicast, documentation…).
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(v4Bytes(address));
  if (version === 6) return isPublicV6(v6Bytes(address));
  return false;
}

type V4 = [number, number, number, number];

const v4Bytes = (address: string): V4 => {
  const parts = address.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
};

function isPublicV4([a, b, c]: V4): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** The 16 bytes of an IPv6 address (with an IPv4 tail, if any). */
function v6Bytes(address: string): number[] {
  let text = address.toLowerCase().split('%')[0] ?? '';
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (tail) {
    const [a, b, c, d] = v4Bytes(tail);
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const groups = (part: string | undefined) =>
    part ? part.split(':').filter(Boolean) : [];
  const left = groups(head);
  const right = groups(rest);
  const missing = rest === undefined ? 0 : 8 - left.length - right.length;
  const all = [...left, ...Array<string>(missing).fill('0'), ...right];
  return all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}

const tailV4 = (bytes: number[]): V4 => [
  bytes[12] ?? 0,
  bytes[13] ?? 0,
  bytes[14] ?? 0,
  bytes[15] ?? 0,
];

function isPublicV6(bytes: number[]): boolean {
  const at = (index: number) => bytes[index] ?? 0;
  const zeros = (from: number, to: number) =>
    bytes.slice(from, to).every((byte) => byte === 0);
  // :: and ::1
  if (zeros(0, 15) && (at(15) === 0 || at(15) === 1)) return false;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (zeros(0, 10) && at(10) === 0xff && at(11) === 0xff)
    return isPublicV4(tailV4(bytes));
  if (zeros(0, 12)) return isPublicV4(tailV4(bytes));
  // NAT64 (64:ff9b::/96) carries an IPv4 address too.
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b)
    return isPublicV4(tailV4(bytes));
  if ((at(0) & 0xfe) === 0xfc) return false; // unique local fc00::/7
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return false; // fe80::/10
  if (at(0) === 0xff) return false; // multicast
  // documentation 2001:db8::/32
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8)
    return false;
  return true;
}
