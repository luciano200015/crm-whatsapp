import { useEffect, useRef } from 'react'

/**
 * Calls `onVisible` when the returned element scrolls into view (infinite
 * lists: older messages, more chats). Nothing happens while `enabled` is false.
 * A new `version` (e.g. the rows loaded) looks again: with short pages the end
 * may still be in view after loading one.
 */
export function useWhenVisible<T extends HTMLElement>(
  onVisible: () => void,
  enabled: boolean,
  version?: unknown,
) {
  const ref = useRef<T>(null)
  const callback = useRef(onVisible)
  useEffect(() => {
    callback.current = onVisible
  }, [onVisible])
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current()
      },
      // Start loading a little before reaching the edge.
      { rootMargin: '200px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, version])
  return ref
}
