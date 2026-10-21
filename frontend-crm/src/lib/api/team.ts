import { apiRequest } from './client'
import type {
  Member,
  MemberList,
  MembershipStatus,
  NewMemberRequest,
  PermissionInfo,
  Role,
  RoleRequest,
} from './types'

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`
const member = (workspaceId: string, memberId: string) =>
  `${base(workspaceId)}/members/${encodeURIComponent(memberId)}`
const role = (workspaceId: string, roleId: string) =>
  `${base(workspaceId)}/roles/${encodeURIComponent(roleId)}`

export interface MemberFilter {
  status?: MembershipStatus
  search?: string
}

export const teamApi = {
  members(workspaceId: string, filter: MemberFilter = {}) {
    const query = new URLSearchParams({ limit: '100' })
    if (filter.status) query.set('status', filter.status)
    if (filter.search) query.set('search', filter.search)
    return apiRequest<MemberList>(`${base(workspaceId)}/members?${query.toString()}`)
  },

  createMember(workspaceId: string, body: NewMemberRequest) {
    return apiRequest<Member>(`${base(workspaceId)}/members`, { method: 'POST', body })
  },

  changeRole(workspaceId: string, memberId: string, roleId: string) {
    return apiRequest<Member>(member(workspaceId, memberId), {
      method: 'PATCH',
      body: { roleId },
    })
  },

  /** channels.manage: replaces the lines the member attends. */
  setLines(workspaceId: string, memberId: string, lineIds: string[]) {
    return apiRequest<Member>(`${member(workspaceId, memberId)}/lines`, {
      method: 'PUT',
      body: { lineIds },
    })
  },

  deactivate(workspaceId: string, memberId: string) {
    return apiRequest<Member>(`${member(workspaceId, memberId)}/deactivate`, { method: 'POST' })
  },

  reactivate(workspaceId: string, memberId: string) {
    return apiRequest<Member>(`${member(workspaceId, memberId)}/reactivate`, { method: 'POST' })
  },

  resendAccess(workspaceId: string, memberId: string) {
    return apiRequest<void>(`${member(workspaceId, memberId)}/resend-access`, { method: 'POST' })
  },

  roles(workspaceId: string) {
    return apiRequest<Role[]>(`${base(workspaceId)}/roles`)
  },

  permissions(workspaceId: string) {
    return apiRequest<PermissionInfo[]>(`${base(workspaceId)}/permissions`)
  },

  createRole(workspaceId: string, body: RoleRequest) {
    return apiRequest<Role>(`${base(workspaceId)}/roles`, { method: 'POST', body })
  },

  updateRole(workspaceId: string, roleId: string, body: Partial<RoleRequest>) {
    return apiRequest<Role>(role(workspaceId, roleId), { method: 'PATCH', body })
  },

  deleteRole(workspaceId: string, roleId: string) {
    return apiRequest<void>(role(workspaceId, roleId), { method: 'DELETE' })
  },
}

export const teamKeys = {
  all: (workspaceId: string) => ['team', workspaceId] as const,
  members: (workspaceId: string, filter: MemberFilter) =>
    ['team', workspaceId, 'members', filter] as const,
  roles: (workspaceId: string) => ['team', workspaceId, 'roles'] as const,
  permissions: (workspaceId: string) => ['team', workspaceId, 'permissions'] as const,
}
