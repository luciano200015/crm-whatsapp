import { useSyncExternalStore } from 'react'
import type { ChatMessage, SharedContact } from '../../lib/api/inbox'

/** What the agent sent, kept until the server answers. */
export type OutgoingPayload =
  | { kind: 'text'; text: string; note: boolean; sign?: boolean }
  | { kind: 'media'; file: File; caption: string | null }
  | { kind: 'contacts'; contacts: { name: string; phone: string }[] }

export interface OutboxItem {
  /** Sent to the API as clientId, so the server message replaces this one. */
  clientId: string
  conversationId: string
  payload: OutgoingPayload
  status: 'pending' | 'failed'
  error: string | null
  sentBy: { userId: string; name: string }
  createdAt: string
}

const EMPTY: OutboxItem[] = []
const items = new Map<string, OutboxItem[]>()
const queues = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

const key = (workspaceId: string, conversationId: string) => `${workspaceId}:${conversationId}`

function set(chat: string, next: OutboxItem[]) {
  if (next.length) items.set(chat, next)
  else items.delete(chat)
  for (const listener of listeners) listener()
}

/**
 * Messages being sent from this browser, per chat. They show at once with
 * the clock (like WhatsApp) while the server sends them to WhatsApp.
 */
export const outbox = {
  add(workspaceId: string, item: OutboxItem) {
    const chat = key(workspaceId, item.conversationId)
    set(chat, [...(items.get(chat) ?? []), item])
  },
  update(
    workspaceId: string,
    conversationId: string,
    clientId: string,
    changes: Partial<OutboxItem>,
  ) {
    const chat = key(workspaceId, conversationId)
    set(
      chat,
      (items.get(chat) ?? []).map((item) =>
        item.clientId === clientId ? { ...item, ...changes } : item,
      ),
    )
  },
  remove(workspaceId: string, conversationId: string, clientId: string) {
    const chat = key(workspaceId, conversationId)
    set(
      chat,
      (items.get(chat) ?? []).filter((item) => item.clientId !== clientId),
    )
  },
  /** Runs sends of one chat one after another, so WhatsApp keeps their order. */
  run(workspaceId: string, conversationId: string, task: () => Promise<void>) {
    const chat = key(workspaceId, conversationId)
    const next = (queues.get(chat) ?? Promise.resolve()).then(task, task)
    queues.set(chat, next)
    void next.finally(() => {
      if (queues.get(chat) === next) queues.delete(chat)
    })
  },
  /** For tests. */
  clear() {
    items.clear()
    queues.clear()
    for (const listener of listeners) listener()
  },
}

export function useOutbox(workspaceId: string, conversationId: string): OutboxItem[] {
  const chat = key(workspaceId, conversationId)
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => items.get(chat) ?? EMPTY,
  )
}

/** A random UUID; randomUUID needs a secure context, getRandomValues does not. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function mediaType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

/** The bubble of a message still on its way. */
export function toLocalMessage(item: OutboxItem): ChatMessage {
  const { payload } = item
  const base = {
    id: `local-${item.clientId}`,
    clientId: item.clientId,
    conversationId: item.conversationId,
    status: item.status,
    error: item.error,
    sentBy: item.sentBy,
    createdAt: item.createdAt,
    media: null,
  } as const
  if (payload.kind === 'text') {
    return {
      ...base,
      direction: payload.note ? 'NOTE' : 'OUT',
      type: 'text',
      text: payload.text,
    }
  }
  if (payload.kind === 'contacts') {
    const contacts: SharedContact[] = payload.contacts.map((contact) => ({
      name: contact.name,
      phones: [{ phone: contact.phone, waId: null, type: 'CELL' }],
      emails: [],
      organization: null,
    }))
    return {
      ...base,
      direction: 'OUT',
      type: 'contacts',
      text: payload.contacts.map((contact) => contact.name).join(', '),
      contacts,
    }
  }
  const type = mediaType(payload.file.type)
  return {
    ...base,
    direction: 'OUT',
    type,
    text: type === 'audio' ? null : payload.caption,
    media: {
      id: '',
      mimeType: payload.file.type || null,
      caption: payload.caption,
      filename: payload.file.name,
      size: payload.file.size,
    },
    localFile: payload.file,
  }
}
