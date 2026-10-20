import { apiRequest } from './client'
import type { Contact, ContactRequest, CursorPage, Tag, TagRequest } from './types'

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`

export interface ContactFilter {
  search?: string
  tagId?: string
}

export const contactsApi = {
  list(workspaceId: string, filter: ContactFilter, cursor?: string) {
    const query = new URLSearchParams({ limit: '50' })
    if (filter.search) query.set('search', filter.search)
    if (filter.tagId) query.set('tagId', filter.tagId)
    if (cursor) query.set('cursor', cursor)
    return apiRequest<CursorPage<Contact>>(`${base(workspaceId)}/contacts?${query.toString()}`)
  },

  create(workspaceId: string, body: ContactRequest) {
    return apiRequest<Contact>(`${base(workspaceId)}/contacts`, { method: 'POST', body })
  },

  update(workspaceId: string, contactId: string, body: Partial<ContactRequest>) {
    return apiRequest<Contact>(`${base(workspaceId)}/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body,
    })
  },

  remove(workspaceId: string, contactId: string) {
    return apiRequest<void>(`${base(workspaceId)}/contacts/${encodeURIComponent(contactId)}`, {
      method: 'DELETE',
    })
  },

  tags(workspaceId: string) {
    return apiRequest<Tag[]>(`${base(workspaceId)}/tags`)
  },

  createTag(workspaceId: string, body: TagRequest) {
    return apiRequest<Tag>(`${base(workspaceId)}/tags`, { method: 'POST', body })
  },

  updateTag(workspaceId: string, tagId: string, body: Partial<TagRequest>) {
    return apiRequest<Tag>(`${base(workspaceId)}/tags/${encodeURIComponent(tagId)}`, {
      method: 'PATCH',
      body,
    })
  },

  removeTag(workspaceId: string, tagId: string) {
    return apiRequest<void>(`${base(workspaceId)}/tags/${encodeURIComponent(tagId)}`, {
      method: 'DELETE',
    })
  },
}

export const contactKeys = {
  all: (workspaceId: string) => ['contacts', workspaceId] as const,
  list: (workspaceId: string, filter: ContactFilter) =>
    ['contacts', workspaceId, 'list', filter] as const,
  tags: (workspaceId: string) => ['contacts', workspaceId, 'tags'] as const,
}
