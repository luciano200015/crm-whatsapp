import { canEncodeOpus } from './ogg-opus'

/** What WhatsApp accepts when we send files (same rules as the API). */
const MB = 1024 * 1024

const RULES: Record<string, number> = {
  'image/jpeg': 5 * MB,
  'image/png': 5 * MB,
  'video/mp4': 16 * MB,
  'video/3gpp': 16 * MB,
  'audio/aac': 16 * MB,
  'audio/amr': 16 * MB,
  'audio/mpeg': 16 * MB,
  'audio/mp4': 16 * MB,
  'audio/ogg': 16 * MB,
  'application/pdf': 16 * MB,
  'text/plain': 16 * MB,
  'application/msword': 16 * MB,
  'application/vnd.ms-excel': 16 * MB,
  'application/vnd.ms-powerpoint': 16 * MB,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 16 * MB,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 16 * MB,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 16 * MB,
}

export const ACCEPT_VISUAL = 'image/jpeg,image/png,video/mp4,video/3gpp'
export const ACCEPT_DOCUMENT = [
  '.pdf',
  '.txt',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  ...Object.keys(RULES).filter((type) => type.startsWith('application/') || type === 'text/plain'),
].join(',')

const baseType = (type: string) => type.split(';')[0]?.trim().toLowerCase() ?? ''

/** Null when the file can be sent; otherwise why not. */
export function fileProblem(file: File): string | null {
  const max = RULES[baseType(file.type)]
  if (!max) {
    return 'WhatsApp no acepta este tipo de archivo. Envía imágenes JPG o PNG, videos MP4, audios o documentos PDF, Word, Excel, PowerPoint o TXT.'
  }
  if (file.size > max) {
    return `El archivo supera el máximo de WhatsApp para su tipo (${max / MB} MB).`
  }
  return null
}

/**
 * How this browser records a voice note WhatsApp accepts (OGG/Opus):
 * natively (Firefox) or recording in its own format and converting it
 * (Chrome, Edge, Safari: see ogg-opus.ts). Null when it cannot.
 */
export function recordingPlan(): { mimeType: string | undefined; convert: boolean } | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    return { mimeType: 'audio/ogg;codecs=opus', convert: false }
  }
  return canEncodeOpus() ? { mimeType: undefined, convert: true } : null
}
