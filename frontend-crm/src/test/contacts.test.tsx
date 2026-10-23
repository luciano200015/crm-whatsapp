import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { es } from '../i18n/es'
import { API_BASE_URL } from '../lib/api/client'
import { tokenStore } from '../lib/api/token-store'
import type { Contact, Me, Tag } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const WS = '/workspaces/w1'

function makeMe(permissions: string[]): Me {
  return {
    id: 'u1',
    email: 'user@example.com',
    displayName: 'Uma',
    status: 'ACTIVE',
    emailVerified: true,
    mustChangePassword: false,
    avatarUrl: null,
    locale: null,
    timezone: null,
    createdAt: '2026-10-19T00:00:00.000Z',
    lastLoginAt: null,
    workspaces: [
      {
        id: 'w1',
        name: 'Acme Corp',
        slug: 'acme',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        roles: [{ id: 'r1', key: 'OWNER', name: 'Owner', system: true }],
        permissions,
        plan: null,
      },
    ],
  }
}

const vip: Tag = {
  id: 't-vip',
  name: 'VIP',
  color: '#eab308',
  description: null,
  contactCount: 1,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
}

const lucia: Contact = {
  id: 'c1',
  phone: '+59171234567',
  name: 'Lucía Fernández',
  email: 'lucia@example.com',
  notes: null,
  tags: [{ id: vip.id, name: vip.name, color: vip.color }],
  source: 'whatsapp',
  lastMessageAt: null,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
}

let me: Me
let posted: { path: string; body: unknown }[]

const server = setupServer(
  http.post(api('/auth/refresh'), () =>
    HttpResponse.json({ accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900 }),
  ),
  http.get(api('/users/me'), () => HttpResponse.json(me)),
  http.get(api('/billing/plans'), () =>
    HttpResponse.json({
      currency: 'USD',
      trialDays: 7,
      defaultPlan: 'team',
      paymentsEnabled: true,
      features: [],
      plans: [],
    }),
  ),
  http.get(api(`${WS}/contacts`), () => HttpResponse.json({ items: [lucia], nextCursor: null })),
  http.get(api(`${WS}/tags`), () => HttpResponse.json([vip])),
  http.post(api(`${WS}/contacts`), async ({ request }) => {
    const body = await request.json()
    posted.push({ path: 'contacts', body })
    return HttpResponse.json({ ...lucia, id: 'c2' }, { status: 201 })
  }),
  http.post(api(`${WS}/tags`), async ({ request }) => {
    const body = await request.json()
    posted.push({ path: 'tags', body })
    return HttpResponse.json(vip, { status: 201 })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  posted = []
  document.cookie = 'crm_csrf=abc; path=/'
})
afterEach(() => {
  server.resetHandlers()
  tokenStore.clear()
  document.cookie = 'crm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})
afterAll(() => server.close())

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

describe('Contacts', () => {
  it('lists contacts with their tags and source', async () => {
    me = makeMe(['contacts.read', 'contacts.write', 'tags.manage'])
    renderAt('/contacts')

    const row = (await screen.findByText('Lucía Fernández')).closest('tr') as HTMLElement
    expect(within(row).getByText('+59171234567')).toBeInTheDocument()
    expect(within(row).getByText('VIP')).toBeInTheDocument()
    expect(within(row).getByText(es.contacts.source.whatsapp)).toBeInTheDocument()
  })

  it('creates a contact', async () => {
    me = makeMe(['contacts.read', 'contacts.write'])
    renderAt('/contacts')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.contacts.newContact }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Teléfono/), '+591 70000001')
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Mario')
    await user.click(within(dialog).getByRole('button', { name: es.contacts.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        {
          path: 'contacts',
          body: { name: 'Mario', phone: '+591 70000001', email: null, notes: null, tagIds: [] },
        },
      ]),
    )
  })

  it('hides editing for users who can only read contacts', async () => {
    me = makeMe(['contacts.read'])
    renderAt('/contacts')

    expect(await screen.findByText('Lucía Fernández')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: es.contacts.newContact })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `${es.contacts.edit} Lucía Fernández` }),
    ).not.toBeInTheDocument()
  })
})

describe('Tags', () => {
  it('creates a tag with a color', async () => {
    me = makeMe(['contacts.read', 'tags.manage'])
    renderAt('/contacts/tags')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.tags.newTag }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Cliente')
    await user.click(within(dialog).getByRole('button', { name: '#43a047' }))
    await user.click(within(dialog).getByRole('button', { name: es.tags.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        { path: 'tags', body: { name: 'Cliente', color: '#43a047', description: null } },
      ]),
    )
  })

  it('creates a tag with any color typed as hex', async () => {
    me = makeMe(['contacts.read', 'tags.manage'])
    renderAt('/contacts/tags')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.tags.newTag }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Outlet')
    const hex = within(dialog).getByLabelText(`${es.tags.form.color} en hexadecimal`)
    await user.clear(hex)
    await user.type(hex, '#66D30F')
    await user.click(within(dialog).getByRole('button', { name: es.tags.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        { path: 'tags', body: { name: 'Outlet', color: '#66d30f', description: null } },
      ]),
    )
  })

  it('is not available without tags.manage', async () => {
    me = makeMe(['contacts.read'])
    const router = renderAt('/contacts/tags')

    expect(await screen.findByRole('heading', { name: es.forbidden.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/forbidden')
  })
})
