import { ApiError, NetworkError } from './errors'
import { tokenStore } from './token-store'
import type { AccessTokenResponse, ErrorResponse } from './types'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
export const CSRF_COOKIE = 'crm_csrf'
const REFRESH_LOCK = 'crm-auth-refresh'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Send the Bearer token and refresh it once on 401 (default true). */
  auth?: boolean
  /** Send X-CSRF-Token from the crm_csrf cookie (refresh-cookie endpoints). */
  csrf?: boolean
  signal?: AbortSignal
}

export function readCookie(name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** True when the browser probably holds a refresh cookie (it is HttpOnly). */
export function hasSessionCookie(): boolean {
  return readCookie(CSRF_COOKIE) !== null
}

let onSessionExpired: (() => void) | null = null

/** Called when a refresh fails after a 401: the user must sign in again. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const token = tokenStore.get()
  if (options.auth !== false && token) headers.set('Authorization', `Bearer ${token}`)
  if (options.csrf) {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      signal: options.signal,
    })
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new NetworkError(error)
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = response.status === 204 ? '' : await response.text()
  const data: unknown = text ? JSON.parse(text) : undefined
  if (!response.ok) throw new ApiError(response.status, (data as ErrorResponse | undefined) ?? null)
  return data as T
}

// ─────────────────────────── Refresh ───────────────────────────

let inFlightRefresh: Promise<boolean> | null = null

/**
 * Exchanges the refresh cookie for a new access token.
 * - Single-flight inside the tab: concurrent 401s share one refresh.
 * - Serialized across tabs with the Web Locks API, because every refresh
 *   rotates the shared cookie and two tabs refreshing with the same cookie
 *   would make one of them look like token reuse.
 */
export function refreshAccessToken(): Promise<boolean> {
  inFlightRefresh ??= withCrossTabLock(doRefresh).finally(() => {
    inFlightRefresh = null
  })
  return inFlightRefresh
}

async function doRefresh(): Promise<boolean> {
  if (!hasSessionCookie()) {
    tokenStore.clear()
    return false
  }
  try {
    const response = await send('/auth/refresh', { method: 'POST', auth: false, csrf: true })
    const tokens = await parse<AccessTokenResponse>(response)
    tokenStore.set(tokens.accessToken, tokens.expiresIn)
    return true
  } catch (error: unknown) {
    if (error instanceof NetworkError) throw error
    tokenStore.clear()
    return false
  }
}

function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request(REFRESH_LOCK, task) : task()
}

// ─────────────────────────── Requests ───────────────────────────

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options)

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      onSessionExpired?.()
      return parse<T>(response)
    }
    return parse<T>(await send(path, options))
  }
  return parse<T>(response)
}
