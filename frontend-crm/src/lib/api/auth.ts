import { apiRequest } from './client'
import { tokenStore } from './token-store'
import type { LoginResponse, MessageResponse, RegisterRequest, Session } from './types'

export const authApi = {
  register(body: RegisterRequest) {
    return apiRequest<MessageResponse>('/auth/register', { method: 'POST', body, auth: false })
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const result = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    tokenStore.set(result.accessToken, result.expiresIn)
    return result
  },

  /** Revokes the session server-side; the local token is cleared regardless. */
  async logout(): Promise<void> {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST', auth: false, csrf: true })
    } finally {
      tokenStore.clear()
    }
  },

  forgotPassword(email: string) {
    return apiRequest<MessageResponse>('/auth/password/forgot', {
      method: 'POST',
      body: { email },
      auth: false,
    })
  },

  resetPassword(token: string, newPassword: string) {
    return apiRequest<void>('/auth/password/reset', {
      method: 'POST',
      body: { token, newPassword },
      auth: false,
    })
  },

  verifyEmail(token: string) {
    return apiRequest<void>('/auth/email/verify', { method: 'POST', body: { token }, auth: false })
  },

  resendVerification() {
    return apiRequest<void>('/auth/email/resend-verification', { method: 'POST' })
  },

  changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<void>('/auth/password/change', {
      method: 'POST',
      body: { currentPassword, newPassword },
    })
  },

  listSessions() {
    return apiRequest<Session[]>('/auth/sessions')
  },

  revokeSession(sessionId: string) {
    return apiRequest<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  },

  revokeOtherSessions() {
    return apiRequest<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' })
  },
}
