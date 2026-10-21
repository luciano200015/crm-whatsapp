import type { ChatMessage, Conversation, ConversationEvent } from '../../lib/api/inbox'

/** Name of the contact, or the phone when WhatsApp did not send one. */
export const contactName = (contact: Conversation['contact']) => contact.name ?? contact.phone

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '#'
  return (
    words.length > 1 ? `${words[0]?.[0]}${words.at(-1)?.[0]}` : (words[0] ?? '#').slice(0, 2)
  ).toUpperCase()
}

const AVATAR_COLORS = [
  '#00a884',
  '#0288d1',
  '#7b1fa2',
  '#c2185b',
  '#ef6c00',
  '#5d4037',
  '#00838f',
  '#558b2f',
]

/** Stable color per contact, like WhatsApp's default avatars. */
export function avatarColor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const daysAgo = (date: Date, now: Date) =>
  Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000)

const time = (date: Date) => date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

/** "10:42", "Ayer", "lunes" or "12/10/2026", as in the chat list of WhatsApp. */
export function listTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const days = daysAgo(date, now)
  if (days <= 0) return time(date)
  if (days === 1) return 'Ayer'
  if (days < 7) return date.toLocaleDateString('es', { weekday: 'long' })
  return date.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Separator between days in the chat: "Hoy", "Ayer" or the full date. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const days = daysAgo(date, now)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
}

export const messageTime = (iso: string) => time(new Date(iso))

export const sameDay = (a: string, b: string) =>
  startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime()

const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎤 Audio',
  sticker: '💟 Sticker',
  document: '📄 Documento',
  location: '📍 Ubicación',
  unsupported: 'Mensaje no compatible',
}

/** Preview of the last message in the chat list. */
export function preview(last: Conversation['lastMessage']): string {
  if (!last) return 'Sin mensajes'
  const label = MEDIA_LABELS[last.type]
  const body =
    last.type === 'text' ? (last.text ?? '') : last.text ? `${label} · ${last.text}` : label
  const prefix = last.direction === 'OUT' ? 'Tú: ' : last.direction === 'NOTE' ? 'Nota: ' : ''
  return `${prefix}${body ?? ''}`
}

export const mediaLabel = (type: string) => MEDIA_LABELS[type] ?? 'Archivo'

/** Centered notice of a movement: "Ana transfirió el chat de Luis a Beto". */
export function eventText(event: ConversationEvent): string {
  const by = event.by?.name ?? 'El sistema'
  const to = event.to?.name ?? ''
  const from = event.from?.name ?? ''
  switch (event.kind) {
    case 'auto_assigned':
      return `Chat asignado automáticamente a ${to}`
    case 'assigned':
      return event.by && event.to && event.by.name === to
        ? `${by} se asignó el chat`
        : `${by} asignó el chat a ${to}`
    case 'transferred':
      return `${by} transfirió el chat de ${from} a ${to}`
    case 'unassigned':
      return `${by} dejó el chat sin asignar${from ? ` (antes: ${from})` : ''}`
    case 'taken':
      return `${by} tomó el chat`
    case 'claimed':
      return `${by} se asignó el chat al responder`
    case 'closed':
      return `${by} cerró el chat`
    case 'reopened':
      return `${by} reabrió el chat`
    case 'contact_blocked':
      return `${by} bloqueó el contacto`
    case 'contact_unblocked':
      return `${by} desbloqueó el contacto`
  }
}

export const DELIVERY_LABELS: Record<ChatMessage['status'], string> = {
  received: 'Recibido',
  pending: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'Error de envío',
}
