import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Height that makes an element reach the bottom of the window from wherever
 * it starts (banners above it may come and go), like a full-screen chat app.
 */
export function useFillHeight<T extends HTMLElement>(bottomGap = 16, minHeight = 480) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY
      setHeight(Math.max(minHeight, window.innerHeight - top - bottomGap))
    }
    measure()
    window.addEventListener('resize', measure)
    // Content above (e.g. the trial banner) can change after the first paint.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (element.parentElement) observer?.observe(element.parentElement)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [bottomGap, minHeight])
  return { ref, height }
}
