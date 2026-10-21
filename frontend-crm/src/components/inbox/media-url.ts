import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { inboxApi, inboxKeys, type ChatMessage } from '../../lib/api/inbox'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

interface ObjectUrl {
  blob: Blob
  url: string
  users: number
  timer?: ReturnType<typeof setTimeout>
}

const objectUrls = new WeakMap<Blob, ObjectUrl>()

/** One object URL per downloaded file, shared by every place that shows it. */
function objectUrl(blob: Blob): string {
  let entry = objectUrls.get(blob)
  if (!entry) {
    entry = { blob, url: URL.createObjectURL(blob), users: 0 }
    objectUrls.set(blob, entry)
  }
  return entry.url
}

function retain(blob: Blob): void {
  const entry = objectUrls.get(blob)
  if (!entry) return
  entry.users += 1
  clearTimeout(entry.timer)
}

/** Delayed, so a quick remount (StrictMode, list re-render) keeps the URL. */
function release(blob: Blob): void {
  const entry = objectUrls.get(blob)
  if (!entry) return
  entry.users -= 1
  entry.timer = setTimeout(() => {
    if (entry.users > 0) return
    URL.revokeObjectURL(entry.url)
    objectUrls.delete(blob)
  }, 1000)
}

/**
 * The file of a message as an object URL, downloaded once with the session
 * token (an <img src> cannot send it). The URL is released shortly after the
 * last viewer unmounts.
 */
export function useMediaUrl(message: ChatMessage) {
  const workspaceId = useActiveWorkspace().active?.id ?? ''
  const local = message.localFile ?? null
  const file = useQuery({
    queryKey: inboxKeys.media(workspaceId, message.id),
    queryFn: ({ signal }) =>
      inboxApi.media(workspaceId, message.conversationId, message.id, signal),
    // Files never change: keep them while the chat is open.
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    // A message still being sent shows the file from memory.
    enabled: !local,
  })
  return { url: useObjectUrl(local ?? file.data ?? null), file }
}

/** Object URL of a blob or file (e.g. an attachment preview), released after unmount. */
export function useObjectUrl(blob: Blob | null): string | null {
  const url = blob ? objectUrl(blob) : null
  useEffect(() => {
    if (!blob) return
    retain(blob)
    return () => release(blob)
  }, [blob])
  return url
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
