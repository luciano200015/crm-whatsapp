import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, apiRequest, refreshAccessToken, setSessionExpiredHandler } from './client'
import { ApiError } from './errors'
import { tokenStore } from './token-store'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function setCsrfCookie(value: string | null) {
  document.cookie = value
    ? `crm_csrf=${value}; path=/`
    : 'crm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

describe('apiRequest', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    tokenStore.clear()
    setCsrfCookie('csrf-123')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setSessionExpiredHandler(null)
    setCsrfCookie(null)
  })

  const headersOf = (call: number) => fetchMock.mock.calls[call]?.[1]?.headers as Headers

  it('sends the access token as a Bearer header', async () => {
    tokenStore.set('access-1', 900)
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }))

    await expect(apiRequest('/users/me')).resolves.toEqual({ ok: true })
    expect(headersOf(0).get('Authorization')).toBe('Bearer access-1')
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    tokenStore.set('expired', 900)
    fetchMock
      .mockResolvedValueOnce(json(401, { statusCode: 401, message: 'Authentication required' }))
      .mockResolvedValueOnce(
        json(200, { accessToken: 'fresh', tokenType: 'Bearer', expiresIn: 900 }),
      )
      .mockResolvedValueOnce(json(200, { id: 'me' }))

    await expect(apiRequest('/users/me')).resolves.toEqual({ id: 'me' })

    const refreshCall = fetchMock.mock.calls[1]
    expect(refreshCall?.[0]).toBe(`${API_BASE_URL}/auth/refresh`)
    expect(headersOf(1).get('X-CSRF-Token')).toBe('csrf-123')
    expect(headersOf(1).get('Authorization')).toBeNull()
    expect(headersOf(2).get('Authorization')).toBe('Bearer fresh')
  })

  it('shares a single refresh between concurrent 401s', async () => {
    tokenStore.set('expired', 900)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        return json(200, { accessToken: 'fresh', tokenType: 'Bearer', expiresIn: 900 })
      }
      const auth = new Headers(init?.headers).get('Authorization')
      return auth === 'Bearer fresh' ? json(200, { url }) : json(401, { message: 'no' })
    })

    const results = await Promise.all([apiRequest('/a'), apiRequest('/b'), apiRequest('/c')])

    expect(results).toHaveLength(3)
    const refreshes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))
    expect(refreshes).toHaveLength(1)
  })

  it('ends the session when the refresh fails', async () => {
    const expired = vi.fn()
    setSessionExpiredHandler(expired)
    tokenStore.set('expired', 900)
    fetchMock
      .mockResolvedValueOnce(json(401, { statusCode: 401, message: 'Authentication required' }))
      .mockResolvedValueOnce(json(401, { statusCode: 401, message: 'Invalid or expired session' }))

    await expect(apiRequest('/users/me')).rejects.toBeInstanceOf(ApiError)
    expect(expired).toHaveBeenCalledOnce()
    expect(tokenStore.get()).toBeNull()
  })

  it('does not try to refresh without a session cookie', async () => {
    setCsrfCookie(null)

    await expect(refreshAccessToken()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not refresh on 401 for unauthenticated calls such as login', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { statusCode: 401, message: 'Invalid' }))

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, auth: false }),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(
      apiRequest('/auth/logout', { method: 'POST', auth: false }),
    ).resolves.toBeUndefined()
  })
})
