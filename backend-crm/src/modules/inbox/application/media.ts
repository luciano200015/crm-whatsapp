import type { Readable } from 'node:stream';
import type { MessageType } from '../../channels/domain/whatsapp-payload';

/** A stored media file, streamed back to the browser. */
export interface StoredMedia {
  stream: Readable;
  size: number;
  mimeType: string;
  filename: string | null;
}

/**
 * Media files of the inbox (MongoDB GridFS): what customers send, downloaded
 * from Meta, and what agents send. Every file belongs to one workspace.
 */
export abstract class MediaStore {
  /** Returns the file id. */
  abstract put(
    workspaceId: string,
    file: {
      body: Readable | Buffer;
      mimeType: string;
      filename: string | null;
    },
  ): Promise<{ fileId: string; size: number }>;
  /** Null when it does not exist in that workspace. */
  abstract open(
    workspaceId: string,
    fileId: string,
  ): Promise<StoredMedia | null>;
}

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

type OutgoingType = Extract<
  MessageType,
  'image' | 'video' | 'audio' | 'document'
>;

/** What WhatsApp accepts per type (Cloud API "supported media types"). */
const OUTGOING: Record<string, { type: OutgoingType; maxBytes: number }> = {
  'image/jpeg': { type: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { type: 'image', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { type: 'video', maxBytes: MAX_MEDIA_BYTES },
  'video/3gpp': { type: 'video', maxBytes: MAX_MEDIA_BYTES },
  'audio/aac': { type: 'audio', maxBytes: MAX_MEDIA_BYTES },
  'audio/amr': { type: 'audio', maxBytes: MAX_MEDIA_BYTES },
  'audio/mpeg': { type: 'audio', maxBytes: MAX_MEDIA_BYTES },
  'audio/mp4': { type: 'audio', maxBytes: MAX_MEDIA_BYTES },
  'audio/ogg': { type: 'audio', maxBytes: MAX_MEDIA_BYTES },
  'application/pdf': { type: 'document', maxBytes: MAX_MEDIA_BYTES },
  'text/plain': { type: 'document', maxBytes: MAX_MEDIA_BYTES },
  'application/msword': { type: 'document', maxBytes: MAX_MEDIA_BYTES },
  'application/vnd.ms-excel': { type: 'document', maxBytes: MAX_MEDIA_BYTES },
  'application/vnd.ms-powerpoint': {
    type: 'document',
    maxBytes: MAX_MEDIA_BYTES,
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    type: 'document',
    maxBytes: MAX_MEDIA_BYTES,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    type: 'document',
    maxBytes: MAX_MEDIA_BYTES,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    type: 'document',
    maxBytes: MAX_MEDIA_BYTES,
  },
};

/** "audio/ogg; codecs=opus" → "audio/ogg". */
export const baseMimeType = (mimeType: string) =>
  mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

/** The WhatsApp type to send a file as, or why it cannot be sent. */
export function outgoingMedia(
  mimeType: string,
  size: number,
):
  | { type: OutgoingType }
  | { error: 'unsupported_type' }
  | { error: 'too_large'; maxBytes: number } {
  const rule = OUTGOING[baseMimeType(mimeType)];
  if (!rule) return { error: 'unsupported_type' };
  if (size > rule.maxBytes)
    return { error: 'too_large', maxBytes: rule.maxBytes };
  return { type: rule.type };
}

/** Types the browser may display inline; everything else is downloaded as a file. */
const INLINE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/3gpp',
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'application/pdf',
]);

/**
 * Response headers for a stored file: a whitelisted Content-Type (anything
 * else is a plain download), never sniffed, and a sanitized filename.
 */
export function mediaHeaders(
  file: Pick<StoredMedia, 'mimeType' | 'filename' | 'size'>,
) {
  const mimeType = baseMimeType(file.mimeType);
  const inline = INLINE.has(mimeType);
  const filename = sanitizeFilename(file.filename) ?? 'archivo';
  return {
    'Content-Type': inline ? mimeType : 'application/octet-stream',
    'Content-Length': String(file.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=3600',
  };
}

export function sanitizeFilename(
  name: string | null | undefined,
): string | null {
  const base = name
    ?.split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    ?.replace(/[\u0000-\u001f"<>:|?*]/g, '')
    .trim()
    .slice(0, 200);
  return base ? base : null;
}
