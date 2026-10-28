import { apiRequest, apiResponse } from './client'
import { ApiError } from './errors'
import type {
  BlockResult,
  Contact,
  ContactRequest,
  CursorPage,
  ErrorResponse,
  Tag,
  TagRequest,
} from './types'

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`
const one = (workspaceId: string, contactId: string) =>
  `${base(workspaceId)}/contacts/${encodeURIComponent(contactId)}`

export type ContactStatus = 'ACTIVE' | 'BLOCKED'

export interface ContactFilter {
  search?: string
  tagId?: string
  status?: ContactStatus
}

export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'

export interface ContactField {
  id: string
  /** Derived from the first name; the values are stored under it. */
  key: string
  label: string
  type: FieldType
  options: string[]
}

export interface ContactFieldRequest {
  label: string
  type: FieldType
  options?: string[]
}

/** One line of «Asignación de asesores». */
export interface LineAssignment {
  lineId: string
  name: string
  displayPhone: string | null
  agents: { membershipId: string; name: string }[]
  agentMembershipId: string | null
  /** «Atendiendo ahora»: who has the open or on-hold chat there. */
  attending: { membershipId: string; name: string } | null
}

export type BulkContactsAction = 'add_tags' | 'remove_tags' | 'delete'

export interface ImportRow {
  phone: string
  name?: string | null
  email?: string | null
  notes?: string | null
  tags?: string[]
  fields?: Record<string, string | number>
}

export type TagMode = 'REPLACE' | 'MERGE'

export interface ImportResult {
  created: number
  updated: number
  failed: { index: number; phone: string; code: string }[]
}

/** Rows per import request (the API accepts up to 200). */
export const IMPORT_BATCH = 200

function filterQuery(filter: ContactFilter): URLSearchParams {
  const query = new URLSearchParams()
  if (filter.search) query.set('search', filter.search)
  if (filter.tagId) query.set('tagId', filter.tagId)
  if (filter.status) query.set('status', filter.status)
  return query
}

export const contactsApi = {
  get(workspaceId: string, contactId: string, signal?: AbortSignal) {
    return apiRequest<Contact>(one(workspaceId, contactId), { signal })
  },
  list(workspaceId: string, filter: ContactFilter, cursor?: string) {
    const query = filterQuery(filter)
    query.set('limit', '50')
    if (cursor) query.set('cursor', cursor)
    return apiRequest<CursorPage<Contact>>(`${base(workspaceId)}/contacts?${query.toString()}`)
  },

  create(workspaceId: string, body: ContactRequest) {
    return apiRequest<Contact>(`${base(workspaceId)}/contacts`, { method: 'POST', body })
  },

  setBlocked(workspaceId: string, contactId: string, blocked: boolean) {
    return apiRequest<BlockResult>(
      `${one(workspaceId, contactId)}/${blocked ? 'block' : 'unblock'}`,
      {
        method: 'POST',
      },
    )
  },
  update(workspaceId: string, contactId: string, body: Partial<ContactRequest>) {
    return apiRequest<Contact>(one(workspaceId, contactId), { method: 'PATCH', body })
  },

  remove(workspaceId: string, contactId: string) {
    return apiRequest<void>(one(workspaceId, contactId), { method: 'DELETE' })
  },

  /** «Asignación de asesores»: every line, its regular agent and who attends now. */
  agents(workspaceId: string, contactId: string) {
    return apiRequest<LineAssignment[]>(`${one(workspaceId, contactId)}/agents`)
  },

  /** Lines not listed keep their regular agent; null removes it. */
  setAgents(
    workspaceId: string,
    contactId: string,
    agents: { lineId: string; membershipId: string | null }[],
  ) {
    return apiRequest<Contact>(`${one(workspaceId, contactId)}/agents`, {
      method: 'PUT',
      body: { agents },
    })
  },

  bulk(
    workspaceId: string,
    body: { contactIds: string[]; action: BulkContactsAction; tagIds?: string[] },
  ) {
    return apiRequest<{ affected: number }>(`${base(workspaceId)}/contacts/bulk`, {
      method: 'POST',
      body,
    })
  },

  importRows(workspaceId: string, rows: ImportRow[], tagMode: TagMode) {
    return apiRequest<ImportResult>(`${base(workspaceId)}/contacts/import`, {
      method: 'POST',
      body: { rows, tagMode },
    })
  },

  /** Without a filter, every contact. */
  async exportCsv(workspaceId: string, filter: ContactFilter = {}) {
    const query = filterQuery(filter).toString()
    const response = await apiResponse(
      `${base(workspaceId)}/contacts/export.csv${query ? `?${query}` : ''}`,
      { accept: 'text/csv' },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ErrorResponse | null
      throw new ApiError(response.status, body)
    }
    return response.blob()
  },

  removeAll(workspaceId: string) {
    return apiRequest<{ deleted: number }>(`${base(workspaceId)}/contacts/delete-all`, {
      method: 'POST',
      body: { confirmation: 'ELIMINAR' },
    })
  },

  fields(workspaceId: string) {
    return apiRequest<ContactField[]>(`${base(workspaceId)}/contact-fields`)
  },

  createField(workspaceId: string, body: ContactFieldRequest) {
    return apiRequest<ContactField>(`${base(workspaceId)}/contact-fields`, {
      method: 'POST',
      body,
    })
  },

  updateField(workspaceId: string, fieldId: string, body: { label?: string; options?: string[] }) {
    return apiRequest<ContactField>(
      `${base(workspaceId)}/contact-fields/${encodeURIComponent(fieldId)}`,
      { method: 'PATCH', body },
    )
  },

  removeField(workspaceId: string, fieldId: string) {
    return apiRequest<void>(`${base(workspaceId)}/contact-fields/${encodeURIComponent(fieldId)}`, {
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
  fields: (workspaceId: string) => ['contacts', workspaceId, 'fields'] as const,
  agents: (workspaceId: string, contactId: string) =>
    ['contacts', workspaceId, 'agents', contactId] as const,
}
