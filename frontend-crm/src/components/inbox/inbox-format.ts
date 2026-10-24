import type { ChatMessage, Conversation, ConversationEvent } from '../../lib/api/inbox'

/** Name of the contact, or the phone when WhatsApp did not send one. */
export const contactName = (contact: Conversation['contact']) => contact.name ?? contact.phone

/** "Carlos Arze" → "C. Arze": who attends a chat, short enough for the list. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return words[0] ?? name
  return `${words[0]?.[0]?.toUpperCase()}. ${words.at(-1)}`
}

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

/** "2:21 pm", as wasapi shows the time in the chat list. */
const shortTime = (date: Date) => {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

/** "2:21 pm", "Ayer", "lunes" or "12/10/2026", as in the chat list of WhatsApp. */
export function listTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const days = daysAgo(date, now)
  if (days <= 0) return shortTime(date)
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
  contacts: '👤 Contacto',
  interactive: '📋 Menú',
  unsupported: 'Mensaje no compatible',
}

/** Preview of the last message in the chat list. */
export function preview(last: Conversation['lastMessage']): string {
  if (!last) return 'Sin mensajes'
  const label = MEDIA_LABELS[last.type]
  const body =
    last.type === 'text' || (last.type === 'interactive' && last.text)
      ? (last.text ?? '')
      : last.text
        ? `${label} · ${last.text}`
        : label
  // With its ✓✓ the list already shows the message is ours, as in WhatsApp.
  const prefix =
    last.direction === 'OUT' && !last.status ? 'Tú: ' : last.direction === 'NOTE' ? 'Nota: ' : ''
  return `${prefix}${body ?? ''}`
}

export const mediaLabel = (type: string) => MEDIA_LABELS[type] ?? 'Archivo'

const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : (names[0] ?? '')

/** What the chatbot did to the tags: "agregó la etiqueta Ventas y quitó Nuevo". */
function tagChanges(tags: ConversationEvent['tags']): string {
  const added = tags?.added ?? []
  const removed = tags?.removed ?? []
  const parts = [
    added.length > 0 &&
      `agregó ${added.length > 1 ? 'las etiquetas' : 'la etiqueta'} ${list(added)}`,
    removed.length > 0 &&
      `quitó ${removed.length > 1 ? 'las etiquetas' : 'la etiqueta'} ${list(removed)}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' y ') : 'cambió las etiquetas'
}

/** " por 24 horas" / " permanentemente", for the events that turn the bot off. */
function pauseText(event: ConversationEvent, after = false): string {
  if (!event.pause) return ''
  const how = event.pause.until ? 'por 24 horas' : 'permanentemente'
  return after ? ` (bot desactivado ${how})` : ` ${how}`
}

/** Centered notice of a movement: "Ana transfirió el chat de Luis a Beto". */
export function eventText(event: ConversationEvent): string {
  // What a chatbot did is signed with its name and a robot.
  const by = event.by
    ? event.by.kind === 'bot'
      ? `🤖 ${event.by.name}`
      : event.by.name
    : 'El sistema'
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
    case 'on_hold':
      return `${by} puso el chat en espera`
    case 'closed':
      return `${by} cerró el chat`
    case 'reopened':
      return event.by ? `${by} reabrió el chat` : 'El cliente volvió a escribir: chat reabierto'
    case 'contact_blocked':
      return `${by} bloqueó el contacto`
    case 'contact_unblocked':
      return `${by} desbloqueó el contacto`
    case 'bot_paused':
      return `${by} desactivó el bot en este chat${pauseText(event)}`
    case 'bot_resumed':
      return `${by} activó el bot en este chat`
    case 'bot_transferred':
      return to
        ? `${event.by ? by : '🤖 El bot'} delegó el chat a ${to}${pauseText(event, true)}`
        : `${event.by ? by : '🤖 El bot'} dejó el chat en la cola sin asignar${pauseText(event, true)}`
    case 'bot_tagged':
      return `${by} ${tagChanges(event.tags)}`
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

export const STATUS_LABELS: Record<Conversation['status'], string> = {
  OPEN: 'Abierto',
  ON_HOLD: 'En espera',
  CLOSED: 'Cerrado',
}

/** Meta's error code at the start of a delivery error: "(#131005) Access denied…". */
export function metaErrorCode(error: string | null): number | null {
  const match = /\(#(\d+)\)/.exec(error ?? '')
  return match ? Number(match[1]) : null
}

const DELIVERY_HINTS: Record<number, string> = {
  131005:
    'Meta negó el permiso para enviar. Revisa en Canales → Probar conexión que el token tenga el permiso whatsapp_business_messaging; si lo regeneraste, guárdalo en la línea.',
  10: 'El token no tiene permiso para esta acción. Genera uno con whatsapp_business_messaging y guárdalo en la línea.',
  200: 'El token no tiene permiso para esta acción. Genera uno con whatsapp_business_messaging y guárdalo en la línea.',
  190: 'El token de la línea venció o fue revocado. Genera uno nuevo en Meta y guárdalo en Canales.',
  131030:
    'Con el número de prueba de Meta solo puedes escribir a números agregados en la lista de destinatarios permitidos.',
  131047: 'Pasaron más de 24 horas desde el último mensaje del cliente: hace falta una plantilla.',
  131026: 'WhatsApp no pudo entregarlo: el número puede no tener WhatsApp o una versión antigua.',
  130429: 'Se alcanzó el límite de envíos de Meta. Espera unos minutos y reintenta.',
  131056: 'Demasiados mensajes seguidos a este cliente. Espera un momento y reintenta.',
  131053: 'WhatsApp no aceptó el archivo (formato o códec). Prueba con otro formato.',
}

/** What the agent can do about a message WhatsApp refused, in plain words. */
export function deliveryHint(error: string | null): string | null {
  const code = metaErrorCode(error)
  if (code !== null && DELIVERY_HINTS[code]) return DELIVERY_HINTS[code]
  if (/media file scrutiny|mediaEngineStatus/i.test(error ?? '')) {
    return DELIVERY_HINTS[131053] ?? null
  }
  return null
}
