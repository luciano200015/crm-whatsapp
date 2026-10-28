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
import type { ContactField, LineAssignment } from '../lib/api/contacts'
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

const company: ContactField = {
  id: 'f1',
  key: 'empresa',
  label: 'Empresa',
  type: 'TEXT',
  options: [],
}

const salesLine: LineAssignment = {
  lineId: 'l1',
  name: 'Camsa S.A.',
  displayPhone: '+591 72164000',
  agents: [
    { membershipId: 'm1', name: 'Carolina Arze' },
    { membershipId: 'm2', name: 'Diego Rojas' },
  ],
  agentMembershipId: null,
  attending: { membershipId: 'm1', name: 'Carolina Arze' },
}

let me: Me
let posted: { path: string; body: unknown }[]
let fields: ContactField[]

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
  http.get(api(`${WS}/contact-fields`), () => HttpResponse.json(fields)),
  http.get(api(`${WS}/contacts/c1/agents`), () => HttpResponse.json([salesLine])),
  http.patch(api(`${WS}/contacts/c1`), async ({ request }) => {
    posted.push({ path: 'patch', body: await request.json() })
    return HttpResponse.json(lucia)
  }),
  http.put(api(`${WS}/contacts/c1/agents`), async ({ request }) => {
    posted.push({ path: 'agents', body: await request.json() })
    return HttpResponse.json({ ...lucia, lineAgents: [{ lineId: 'l1', membershipId: 'm2' }] })
  }),
  http.post(api(`${WS}/contacts/bulk`), async ({ request }) => {
    posted.push({ path: 'bulk', body: await request.json() })
    return HttpResponse.json({ affected: 1 })
  }),
  http.post(api(`${WS}/contacts/delete-all`), async ({ request }) => {
    posted.push({ path: 'delete-all', body: await request.json() })
    return HttpResponse.json({ deleted: 1 })
  }),
  http.post(api(`${WS}/contacts/import`), async ({ request }) => {
    posted.push({ path: 'import', body: await request.json() })
    return HttpResponse.json({
      created: 1,
      updated: 0,
      failed: [{ index: 1, phone: '12', code: 'INVALID_PHONE' }],
    })
  }),
  http.get(api(`${WS}/contacts/export.csv`), ({ request }) => {
    posted.push({ path: 'export', body: new URL(request.url).search })
    return new HttpResponse('\uFEFFNombre\r\n', { headers: { 'Content-Type': 'text/csv' } })
  }),
  http.post(api(`${WS}/contact-fields`), async ({ request }) => {
    const body = (await request.json()) as ContactField
    posted.push({ path: 'fields', body })
    return HttpResponse.json({ ...body, id: 'f9', key: 'ciudad' }, { status: 201 })
  }),
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
  fields = []
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
  it('lists contacts with their tags and status', async () => {
    me = makeMe(['contacts.read', 'contacts.write', 'tags.manage', 'messages.read'])
    renderAt('/contacts')

    const row = (await screen.findByText('Lucía Fernández')).closest('tr') as HTMLElement
    expect(within(row).getByText('+59171234567')).toBeInTheDocument()
    expect(within(row).getByText('VIP')).toBeInTheDocument()
    expect(within(row).getByText(es.contacts.status.ACTIVE)).toBeInTheDocument()
    // Without a message yet there is no chat to open.
    expect(
      within(row).getByRole('link', { name: `${es.contacts.startChat} con Lucía Fernández` }),
    ).toHaveAttribute('aria-disabled', 'true')
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
          body: {
            name: 'Mario',
            phone: '+591 70000001',
            email: null,
            notes: null,
            tagIds: [],
            fields: {},
          },
        },
      ]),
    )
  })

  it('fills custom fields and assigns an adviser per line', async () => {
    me = makeMe(['contacts.read', 'contacts.write'])
    fields = [company]
    renderAt('/contacts')
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: `${es.contacts.edit} Lucía Fernández` }),
    )
    const dialog = await screen.findByRole('dialog', { name: es.contacts.form.editTitle })
    await user.type(await within(dialog).findByLabelText('Empresa'), 'Camsa')

    await user.click(within(dialog).getByRole('tab', { name: es.contacts.form.agentsTab }))
    expect(await within(dialog).findByText('Camsa S.A.')).toBeInTheDocument()
    expect(
      within(dialog).getByText(es.contacts.form.attending('Carolina Arze')),
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('combobox', { name: new RegExp(es.contacts.form.regularAgent) }),
    )
    await user.click(await screen.findByRole('option', { name: 'Diego Rojas' }))
    await user.click(within(dialog).getByRole('button', { name: es.contacts.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        {
          path: 'patch',
          body: expect.objectContaining({ fields: { empresa: 'Camsa' } }) as unknown,
        },
        { path: 'agents', body: { agents: [{ lineId: 'l1', membershipId: 'm2' }] } },
      ]),
    )
  })

  it('tags and deletes the selected contacts', async () => {
    me = makeMe(['contacts.read', 'contacts.write'])
    renderAt('/contacts')
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('checkbox', { name: es.contacts.select('Lucía Fernández') }),
    )
    expect(screen.getByText(es.contacts.selected(1))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: es.contacts.addTags }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(es.contacts.columns.tags))
    await user.click(await screen.findByRole('option', { name: 'VIP' }))
    await user.click(within(dialog).getByRole('button', { name: es.contacts.addTags }))

    await waitFor(() =>
      expect(posted).toEqual([
        { path: 'bulk', body: { contactIds: ['c1'], action: 'add_tags', tagIds: ['t-vip'] } },
      ]),
    )
  })

  it('offers «Más opciones» only with contacts.manage', async () => {
    me = makeMe(['contacts.read', 'contacts.write'])
    renderAt('/contacts')
    expect(await screen.findByText('Lucía Fernández')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: es.contacts.more.button })).not.toBeInTheDocument()
  })

  it('exports and deletes every contact from «Más opciones»', async () => {
    me = makeMe(['contacts.read', 'contacts.write', 'contacts.manage'])
    renderAt('/contacts')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.contacts.more.button }))
    expect(screen.getByRole('menuitem', { name: es.contacts.more.exportFiltered })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('menuitem', { name: es.contacts.more.exportAll }))
    expect(await screen.findByText(es.contacts.exported)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: es.contacts.more.button }))
    await user.click(screen.getByRole('menuitem', { name: es.contacts.more.deleteAll }))
    const dialog = await screen.findByRole('dialog', { name: es.contacts.deleteAll.title })
    const confirm = within(dialog).getByRole('button', { name: es.contacts.deleteAll.confirm })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(es.contacts.deleteAll.confirmLabel), 'ELIMINAR')
    await user.click(confirm)

    await waitFor(() =>
      expect(posted).toEqual([
        { path: 'export', body: '' },
        { path: 'delete-all', body: { confirmation: 'ELIMINAR' } },
      ]),
    )
  })

  it('imports a CSV assigning its columns', async () => {
    me = makeMe(['contacts.read', 'contacts.write', 'contacts.manage'])
    fields = [company]
    renderAt('/contacts')
    const user = userEvent.setup()
    const t = es.contacts.import

    await user.click(await screen.findByRole('button', { name: es.contacts.more.button }))
    await user.click(screen.getByRole('menuitem', { name: es.contacts.more.import }))
    const dialog = await screen.findByRole('dialog', { name: t.title })
    const csv =
      'Nombre;Apellido;Celular;Etiquetas;Empresa;Color\nAna;Paz;+59170000001;VIP, Feria;Camsa;rojo\nBeto;;12;;;\n'
    await user.upload(
      within(dialog).getByLabelText(t.fileLabel),
      new File([csv], 'clientes.csv', { type: 'text/csv' }),
    )

    // Columns are guessed by their names; «Color» is skipped.
    expect(await within(dialog).findByText(t.rows(2))).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: `${t.assign}: Color` })).toHaveTextContent(
      t.skip,
    )
    await user.click(within(dialog).getByRole('radio', { name: new RegExp(t.replaceTags) }))
    await user.click(within(dialog).getByRole('button', { name: t.next }))
    expect(within(dialog).getByText(t.summary(2))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t.start }))

    expect(await within(dialog).findByText(t.failures)).toBeInTheDocument()
    expect(within(dialog).getByText(/Fila 3 · 12 · Teléfono inválido/)).toBeInTheDocument()
    expect(posted).toEqual([
      {
        path: 'import',
        body: {
          tagMode: 'REPLACE',
          rows: [
            {
              phone: '+59170000001',
              name: 'Ana Paz',
              tags: ['VIP', 'Feria'],
              fields: { empresa: 'Camsa' },
            },
            { phone: '12', name: 'Beto' },
          ],
        },
      },
    ])
  })

  it('creates a list custom field', async () => {
    me = makeMe(['contacts.read', 'contacts.write', 'contacts.manage'])
    renderAt('/contacts')
    const user = userEvent.setup()
    const t = es.contacts.fields

    await user.click(await screen.findByRole('button', { name: es.contacts.more.button }))
    await user.click(screen.getByRole('menuitem', { name: es.contacts.more.fields }))
    const dialog = await screen.findByRole('dialog', { name: t.title })
    await user.click(await within(dialog).findByRole('button', { name: t.add }))
    await user.type(within(dialog).getByLabelText(t.label), 'Ciudad')
    await user.click(within(dialog).getByRole('combobox', { name: t.type }))
    await user.click(await screen.findByRole('option', { name: t.types.SELECT }))
    const options = within(dialog).getByLabelText(t.options)
    await user.type(options, 'La Paz{Enter}Santa Cruz{Enter}')
    await user.click(within(dialog).getByRole('button', { name: es.contacts.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        {
          path: 'fields',
          body: { label: 'Ciudad', type: 'SELECT', options: ['La Paz', 'Santa Cruz'] },
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
