import Chip from '@mui/material/Chip'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { usePermissions } from '../../auth/usePermissions'
import { apiResponse } from '../../lib/api/client'
import { readEvents } from '../../lib/api/event-stream'
import { funnelKeys } from '../../lib/api/funnels'
import { inboxBase, inboxKeys, type ChatMessage, type Conversation } from '../../lib/api/inbox'
import { tokenStore } from '../../lib/api/token-store'
import { meQueryKey } from '../../lib/api/users'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { contactName, mediaLabel } from './inbox-format'
import { getAlertPreferences, playChime, showDesktopAlert, withUnreadCount } from './notifications'
import { useInboxCounts } from './useInboxCounts'

/** Keeps "(N) " with the unread messages in front of the tab title. */
function useUnreadTitle(unread: number) {
  useEffect(() => {
    const apply = () => {
      const next = withUnreadCount(document.title, unread)
      if (next !== document.title) document.title = next
    }
    apply()
    // Pages set their own title: put the count back when it changes.
    const title = document.querySelector('title')
    const observer = title ? new MutationObserver(apply) : null
    if (title) observer?.observe(title, { childList: true, characterData: true, subtree: true })
    return () => {
      observer?.disconnect()
      document.title = withUnreadCount(document.title, 0)
    }
  }, [unread])
}

/** Is the member looking at this chat right now? Then no alert is needed. */
function viewing(conversationId: string): boolean {
  return (
    document.visibilityState === 'visible' &&
    window.location.pathname === '/inbox' &&
    new URLSearchParams(window.location.search).get('conversation') === conversationId
  )
}

export function UnreadBadge() {
  const { data } = useInboxCounts()
  return data?.unread ? (
    <Chip
      size="small"
      color="primary"
      label={data.unread > 99 ? '99+' : data.unread}
      aria-label={`${data.unread} mensajes no leídos`}
    />
  ) : null
}

export function InboxRealtime() {
  const { active } = useActiveWorkspace()
  const { has } = usePermissions()
  const client = useQueryClient()
  const counts = useInboxCounts()
  useUnreadTitle(counts.data?.unread ?? 0)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const workspaceId = active?.id ?? ''
  const allowed = has('messages.read')
  const permissionKey = active?.permissions.join(',') ?? ''

  useEffect(() => {
    if (!workspaceId || !allowed) return
    let stopped = false
    let controller: AbortController | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const invalidate = () => client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
    // Sound and desktop notification for customer messages, like WhatsApp Web.
    const alert = (data: unknown) => {
      const { conversation, message } = (data ?? {}) as {
        conversation?: Conversation
        message?: ChatMessage
      }
      if (!conversation || message?.direction !== 'IN' || viewing(conversation.id)) return
      const preferences = getAlertPreferences()
      if (preferences.sound) playChime()
      if (preferences.desktop && document.visibilityState !== 'visible') {
        showDesktopAlert({
          title: contactName(conversation.contact),
          body: message.text ?? mediaLabel(message.type),
          tag: conversation.id,
          onClick: () =>
            void navigateRef.current(`/inbox?conversation=${encodeURIComponent(conversation.id)}`),
        })
      }
    }
    const connect = async () => {
      if (stopped || !tokenStore.get()) return
      const current = new AbortController()
      controller = current
      try {
        const response = await apiResponse(`${inboxBase(workspaceId)}/events`, {
          accept: 'text/event-stream',
          signal: current.signal,
        })
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          stopped = true
          client.removeQueries({ queryKey: inboxKeys.all(workspaceId) })
          await client.invalidateQueries({ queryKey: meQueryKey })
          return
        }
        if (!response.ok || !response.body) throw new Error('Stream unavailable')
        await invalidate()
        await readEvents(response.body, current.signal, (type, data) => {
          attempt = 0
          if (type === 'message.created') alert(data)
          if (type === 'ping') {
            void client.invalidateQueries({ queryKey: meQueryKey })
            return
          }
          // Boards show the chat's status, agent and last message.
          void client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) })
          if (type === 'funnel.changed') return
          if (type === 'conversation.removed') {
            client.removeQueries({ queryKey: ['inbox', workspaceId, 'conversation'] })
            client.removeQueries({ queryKey: ['inbox', workspaceId, 'messages'] })
          }
          void invalidate()
        })
      } catch (error: unknown) {
        if (current.signal.aborted) return
        if (!(error instanceof Error)) throw error
      } finally {
        if (!stopped && !current.signal.aborted) {
          timeout = setTimeout(
            () => void connect(),
            Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)),
          )
        }
      }
    }
    const unsubscribe = tokenStore.subscribe(() => {
      controller?.abort()
      clearTimeout(timeout)
      if (tokenStore.get()) void connect()
    })
    void connect()
    return () => {
      stopped = true
      controller?.abort()
      clearTimeout(timeout)
      unsubscribe()
      void client.cancelQueries({ queryKey: inboxKeys.all(workspaceId) })
      client.removeQueries({ queryKey: inboxKeys.all(workspaceId) })
    }
  }, [workspaceId, allowed, permissionKey, client])
  return null
}
