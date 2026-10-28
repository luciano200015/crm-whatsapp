import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useMe } from '../../auth/useMe'
import { errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys, type ChatMessage } from '../../lib/api/inbox'
import type { CursorPage } from '../../lib/api/types'
import {
  newClientId,
  outbox,
  toLocalMessage,
  useOutbox,
  type OutboxItem,
  type OutgoingPayload,
} from './outbox'

const REFUSED: Record<OutgoingPayload['kind'], string> = {
  text: 'No se pudo enviar. Revisa el estado del mensaje antes de intentar nuevamente.',
  media: 'WhatsApp no aceptó el archivo',
  contacts: 'WhatsApp no aceptó el contacto',
}

/**
 * Sending from a chat, as in WhatsApp: the message shows at once with the
 * clock and goes out in order; the server's message (✓, ✓✓) replaces it.
 * If the request fails it stays as "No enviado" with Reintentar.
 */
export function useSendQueue(workspaceId: string, conversationId: string) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const me = useMe().data
  const items = useOutbox(workspaceId, conversationId)

  const deliver = ({ clientId, payload }: OutboxItem) => {
    switch (payload.kind) {
      case 'text':
        return inboxApi.send(
          workspaceId,
          conversationId,
          payload.text,
          payload.note,
          clientId,
          payload.sign,
        )
      case 'media':
        return inboxApi.sendMedia(
          workspaceId,
          conversationId,
          payload.file,
          payload.caption,
          clientId,
        )
      case 'contacts':
        return inboxApi.sendContacts(workspaceId, conversationId, payload.contacts, clientId)
    }
  }

  const process = (item: OutboxItem) =>
    outbox.run(workspaceId, conversationId, async () => {
      outbox.update(workspaceId, conversationId, item.clientId, {
        status: 'pending',
        error: null,
      })
      try {
        const message = await deliver(item)
        client.setQueryData<InfiniteData<CursorPage<ChatMessage>>>(
          inboxKeys.messages(workspaceId, conversationId),
          (data) => {
            if (!data || data.pages.some((page) => page.items.some((m) => m.id === message.id)))
              return data
            const [first, ...rest] = data.pages
            return {
              ...data,
              pages: [{ ...first!, items: [message, ...(first?.items ?? [])] }, ...rest],
            }
          },
        )
        outbox.remove(workspaceId, conversationId, item.clientId)
        if (message.status === 'failed') {
          enqueueSnackbar(
            item.payload.kind === 'text'
              ? REFUSED.text
              : `${REFUSED[item.payload.kind]}: ${message.error ?? 'error desconocido'}`,
            { variant: 'error' },
          )
        }
        void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      } catch (error: unknown) {
        outbox.update(workspaceId, conversationId, item.clientId, {
          status: 'failed',
          error: errorMessage(error),
        })
      }
    })

  const send = (payload: OutgoingPayload) => {
    const item: OutboxItem = {
      clientId: newClientId(),
      conversationId,
      payload,
      status: 'pending',
      error: null,
      sentBy: { userId: me?.id ?? '', name: me?.displayName ?? '' },
      createdAt: new Date().toISOString(),
    }
    outbox.add(workspaceId, item)
    process(item)
  }

  return {
    /** Bubbles still on their way, oldest first. */
    pending: items.map(toLocalMessage),
    send,
    retry: (clientId: string) => {
      const item = items.find((candidate) => candidate.clientId === clientId)
      if (item) process(item)
    },
    discard: (clientId: string) => outbox.remove(workspaceId, conversationId, clientId),
  }
}
