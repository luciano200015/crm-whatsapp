import Chip from '@mui/material/Chip'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { apiResponse } from '../../lib/api/client'
import { readEvents } from '../../lib/api/event-stream'
import { inboxBase, inboxKeys } from '../../lib/api/inbox'
import { tokenStore } from '../../lib/api/token-store'
import { meQueryKey } from '../../lib/api/users'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { useInboxCounts } from './useInboxCounts'

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
        await readEvents(response.body, current.signal, (type) => {
          attempt = 0
          if (type === 'ping') {
            void client.invalidateQueries({ queryKey: meQueryKey })
            return
          }
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
