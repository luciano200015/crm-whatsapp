import { useSyncExternalStore } from 'react'

/** Per-browser preferences of new-message alerts. */
export interface AlertPreferences {
  sound: boolean
  desktop: boolean
}

const KEY = 'crm.inbox.alerts'
const DEFAULTS: AlertPreferences = { sound: true, desktop: false }
const listeners = new Set<() => void>()
let cached: AlertPreferences | null = null

function read(): AlertPreferences {
  if (cached) return cached
  try {
    const stored = JSON.parse(
      localStorage.getItem(KEY) ?? 'null',
    ) as Partial<AlertPreferences> | null
    cached = { ...DEFAULTS, ...stored }
  } catch {
    // Storage can be blocked (private mode): defaults still work.
    cached = { ...DEFAULTS }
  }
  return cached
}

export function getAlertPreferences(): AlertPreferences {
  return read()
}

export function setAlertPreferences(changes: Partial<AlertPreferences>): void {
  cached = { ...read(), ...changes }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // Kept for this tab only.
  }
  listeners.forEach((listener) => listener())
}

export function useAlertPreferences(): AlertPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => DEFAULTS,
  )
}

let audio: AudioContext | null = null

/**
 * A short two-tone chime, made with Web Audio (no sound files). Browsers
 * only play it after the user interacted with the page.
 */
export function playChime(): void {
  try {
    audio ??= new AudioContext()
    const context = audio
    if (context.state === 'suspended') void context.resume()
    const start = context.currentTime
    for (const [index, frequency] of [880, 1318.5].entries()) {
      const at = start + index * 0.13
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.25)
    }
  } catch {
    // No audio support: the badge and title still show the message.
  }
}

export const desktopSupported = () => typeof Notification !== 'undefined'

/** Asks the browser for permission; only call it from a click. */
export async function enableDesktopAlerts(): Promise<boolean> {
  if (!desktopSupported()) return false
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
  const granted = permission === 'granted'
  setAlertPreferences({ desktop: granted })
  return granted
}

export function showDesktopAlert(alert: {
  title: string
  body: string
  tag: string
  onClick: () => void
}): void {
  if (!desktopSupported() || Notification.permission !== 'granted') return
  try {
    const notification = new Notification(alert.title, {
      body: alert.body,
      // One notification per chat: a newer message replaces the previous one.
      tag: alert.tag,
    })
    notification.onclick = () => {
      window.focus()
      alert.onClick()
      notification.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

const COUNT_PREFIX = /^\(\d+\+?\) /

/** "(3) Bandeja de mensajes | CRM": the unread count in the tab title. */
export function withUnreadCount(title: string, unread: number): string {
  const base = title.replace(COUNT_PREFIX, '')
  if (unread <= 0) return base
  return `(${unread > 99 ? '99+' : unread}) ${base}`
}
