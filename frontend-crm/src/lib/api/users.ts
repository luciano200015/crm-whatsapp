import { apiRequest } from './client'
import type { Me, UpdateMeRequest } from './types'

export const usersApi = {
  me() {
    return apiRequest<Me>('/users/me')
  },

  updateMe(body: UpdateMeRequest) {
    return apiRequest<Me>('/users/me', { method: 'PATCH', body })
  },
}

export const meQueryKey = ['users', 'me'] as const
