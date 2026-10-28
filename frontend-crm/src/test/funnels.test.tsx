import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../AppProviders'
import { es } from '../i18n/es'
import { API_BASE_URL } from '../lib/api/client'
import type {
  Board,
  BoardColumn,
  ContactFunnel,
  Funnel,
  FunnelSummary,
  Lead,
} from '../lib/api/funnels'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const BASE = '/workspaces/w1/funnels'
const t = es.funnels

const ALL = ['funnels.read', 'funnels.write', 'funnels.manage', 'messages.read', 'contacts.read']

function makeMe(permissions: string[]): Me {
  return {
    id: 'u1',
    email: 'owner@example.com',
    displayName: 'Olga',
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

const STAGES = [
  { id: 's1', name: 'Nuevo', position: 0 },
  { id: 's2', name: 'En atención', position: 1 },
  { id: 's3', name: 'Cerrado', position: 2 },
]

const summary: FunnelSummary = {
  id: 'f1',
  name: 'Ventas',
  description: 'Clientes nuevos',
  lineId: 'l1',
  lineName: 'Línea Ventas',
  isPrimary: true,
  archiveAfterDays: null,
  leads: 2,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
}
const funnel: Funnel = { ...summary, stages: STAGES, syncRules: [] }

const lead = (id: string, name: string, stageId: string, amountCents: number): Lead => ({
  id,
  funnelId: 'f1',
  stageId,
  contactId: `c-${id}`,
  amountCents,
  archivedAt: null,
  archivedBy: null,
  activityAt: '2026-10-27T10:00:00.000Z',
  version: 3,
  createdAt: '2026-10-20T00:00:00.000Z',
  contact: { name, phone: '+59170000001', tagIds: [] },
  conversation: null,
})

let me: Me
let funnels: FunnelSummary[]
let leads: Lead[]
let preferences: { showValue: boolean; showAgent: boolean }
let boardQueries: URLSearchParams[]
let requests: { method: string; path: string; body: unknown }[]
let failMoves: boolean

function board(): Board {
  const columns: BoardColumn[] = STAGES.map((stage) => {
    const inStage = leads.filter((item) => item.stageId === stage.id)
    return {
      stage,
      count: inStage.length,
      totalCents: inStage.reduce((sum, item) => sum + item.amountCents, 0),
      hasMore: false,
      leads: inStage,
    }
  })
  return {
    funnel,
    preferences,
    columns,
    count: leads.length,
    totalCents: leads.reduce((sum, item) => sum + item.amountCents, 0),
  }
}

const record = async (request: Request) => {
  const url = new URL(request.url)
  const text = request.method === 'GET' ? '' : await request.text()
  requests.push({
    method: request.method,
    path: url.pathname.replace(/^.*\/workspaces\/w1/, '') + url.search,
    body: text ? (JSON.parse(text) as unknown) : null,
  })
}

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
  http.get(
    api('/workspaces/w1/conversations/events'),
    () => new HttpResponse(null, { status: 403 }),
  ),
  http.get(api('/workspaces/w1/conversations/counts'), () =>
    HttpResponse.json({ mine: 0, unassigned: 0, all: 0, onHold: 0, closed: 0, unread: 0 }),
  ),
  http.get(api('/workspaces/w1/conversations/options'), () =>
    HttpResponse.json({
      viewAll: true,
      lines: [{ id: 'l1', name: 'Línea Ventas', status: 'CONNECTED' }],
      members: [{ membershipId: 'm2', userId: 'u2', name: 'Ana Agente' }],
    }),
  ),
  http.get(api('/workspaces/w1/tags'), () => HttpResponse.json([])),
  http.get(api('/workspaces/w1/contacts'), () =>
    HttpResponse.json({
      items: [
        {
          id: 'c-a',
          phone: '+59170000001',
          name: 'Ana Pérez',
          email: null,
          notes: null,
          tags: [],
          source: 'whatsapp',
          lastMessageAt: null,
          createdAt: '2026-10-20T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    }),
  ),
  http.get(api(BASE), () => HttpResponse.json(funnels)),
  http.post(api(BASE), async ({ request }) => {
    await record(request)
    funnels = [{ ...summary, id: 'f9', name: 'Postventa', isPrimary: false, leads: 0 }]
    return HttpResponse.json({ ...funnel, id: 'f9', name: 'Postventa' }, { status: 201 })
  }),
  http.get(api(`${BASE}/f1/board`), ({ request }) => {
    boardQueries.push(new URL(request.url).searchParams)
    return HttpResponse.json(board())
  }),
  http.get(api(`${BASE}/f9/board`), () =>
    HttpResponse.json({ ...board(), funnel: { ...funnel, id: 'f9', name: 'Postventa' } }),
  ),
  http.get(api(`${BASE}/f1`), () => HttpResponse.json(funnel)),
  http.put(api(`${BASE}/f1/preferences`), async ({ request }) => {
    await record(request)
    preferences = (requests.at(-1)?.body ?? preferences) as typeof preferences
    return HttpResponse.json(preferences)
  }),
  http.patch(api(`${BASE}/f1/leads/:leadId/stage`), async ({ request, params }) => {
    await record(request)
    if (failMoves)
      return HttpResponse.json(
        {
          statusCode: 409,
          error: 'Conflict',
          message: 'changed',
          code: 'LEAD_CHANGED',
          timestamp: '',
        },
        { status: 409 },
      )
    const { stageId } = requests.at(-1)!.body as { stageId: string }
    leads = leads.map((item) => (item.id === params.leadId ? { ...item, stageId } : item))
    return HttpResponse.json(leads.find((item) => item.id === params.leadId))
  }),
  http.post(api(`${BASE}/f1/leads`), async ({ request }) => {
    await record(request)
    return HttpResponse.json(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'exists',
        code: 'LEAD_EXISTS',
        details: { leadId: 'a', stageId: 's1' },
        timestamp: '',
      },
      { status: 409 },
    )
  }),
  http.delete(api(`${BASE}/f1/stages/:stageId`), async ({ request }) => {
    await record(request)
    return HttpResponse.json(funnel)
  }),
  http.post(api(`${BASE}/f1/sync`), async ({ request }) => {
    await record(request)
    return HttpResponse.json({ created: 4, skipped: 2, failed: 0 })
  }),
  http.get(
    api(`${BASE}/f1/export.csv`),
    () => new HttpResponse('﻿Nombre\r\n', { headers: { 'Content-Type': 'text/csv' } }),
  ),
  http.get(api(`${BASE}/contacts/:contactId`), () => {
    const funnels: ContactFunnel[] = [
      {
        funnelId: 'f1',
        funnelName: 'Ventas',
        lineId: 'l1',
        lineName: 'Línea Ventas',
        stages: STAGES,
        lead: { id: 'a', stageId: 's1', amountCents: 150000, archivedAt: null, version: 3 },
      },
    ]
    return HttpResponse.json(funnels)
  }),
  http.put(api(`${BASE}/contacts/:contactId`), async ({ request }) => {
    await record(request)
    return HttpResponse.json([])
  }),
)

beforeAll(() => server.listen())
beforeEach(() => {
  me = makeMe(ALL)
  funnels = [summary]
  leads = [lead('a', 'Ana Pérez', 's1', 150000), lead('b', 'Beto Ríos', 's2', 25050)]
  preferences = { showValue: true, showAgent: true }
  boardQueries = []
  requests = []
  failMoves = false
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

const column = async (name: string) => screen.findByRole('region', { name })

describe('Funnels', () => {
  it('creates the first funnel with the default stages', async () => {
    funnels = []
    const router = renderAt('/funnels')
    const user = userEvent.setup()
    expect(await screen.findByText(t.empty)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.newFunnel }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: t.form.line }))
    await user.click(await screen.findByRole('option', { name: 'Línea Ventas' }))
    await user.type(within(dialog).getByRole('textbox', { name: t.form.name }), 'Postventa')
    expect(within(dialog).getByRole('checkbox', { name: t.form.defaultStages })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: t.form.create }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/funnels/f9'))
    expect(requests[0]).toMatchObject({
      method: 'POST',
      body: {
        lineId: 'l1',
        name: 'Postventa',
        isPrimary: false,
        defaultStages: true,
        archiveAfterDays: null,
      },
    })
  })

  it('opens the last funnel and shows counts and totals per stage', async () => {
    const router = renderAt('/funnels')
    await waitFor(() => expect(router.state.location.pathname).toBe('/funnels/f1'))
    const nuevo = await column('Nuevo')
    expect(within(nuevo).getByText('Ana Pérez')).toBeInTheDocument()
    expect(within(nuevo).getByText('1')).toBeInTheDocument()
    expect(within(nuevo).getAllByText(/\$ 1\.?500,00/).length).toBeGreaterThan(0)
    // The total of the stage and the value of its card.
    expect(within(await column('En atención')).getAllByText(/\$ 250,50/)).toHaveLength(2)
    expect(screen.getByText(t.total(2))).toBeInTheDocument()
    // The card says why there is no preview.
    expect(within(nuevo).getByText(t.lead.noChat)).toBeInTheDocument()
  })

  it('hides the value and the agent with «Personalizar tablero»', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    const nuevo = await column('Nuevo')
    expect(within(nuevo).getAllByText(/\$ 1\.?500,00/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: t.customize }))
    await user.click(screen.getByLabelText(t.showValue))
    await waitFor(() => expect(within(nuevo).queryByText(/\$ 1\.?500,00/)).toBeNull())
    expect(requests.at(-1)).toMatchObject({
      method: 'PUT',
      body: { showValue: false, showAgent: true },
    })
  })

  it('moves a lead with «Mover a…», with its version, and updates the counts', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    const nuevo = await column('Nuevo')
    await user.click(within(nuevo).getByRole('button', { name: t.lead.menu('Ana Pérez') }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cerrado' }))

    const cerrado = await column('Cerrado')
    expect(await within(cerrado).findByText('Ana Pérez')).toBeInTheDocument()
    expect(within(nuevo).queryByText('Ana Pérez')).toBeNull()
    expect(within(nuevo).getByText(t.stage.empty)).toBeInTheDocument()
    expect(requests.at(-1)).toMatchObject({
      method: 'PATCH',
      path: `/funnels/f1/leads/a/stage`,
      body: { stageId: 's3', version: 3 },
    })
  })

  it('puts the lead back when the move fails', async () => {
    failMoves = true
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    const nuevo = await column('Nuevo')
    await user.click(within(nuevo).getByRole('button', { name: t.lead.menu('Ana Pérez') }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cerrado' }))

    expect(await screen.findByText(es.apiErrors.LEAD_CHANGED)).toBeInTheDocument()
    expect(await within(nuevo).findByText('Ana Pérez')).toBeInTheDocument()
    expect(within(await column('Cerrado')).queryByText('Ana Pérez')).toBeNull()
  })

  it('combines filters, and «Limpiar» keeps only the search', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await column('Nuevo')
    await user.type(screen.getByRole('textbox', { name: t.search }), 'ana')
    await waitFor(() => expect(boardQueries.at(-1)?.get('search')).toBe('ana'))

    // The drawer hides the page while it closes.
    const filtersButton = () => screen.findByRole('button', { name: new RegExp(t.filters) })
    await user.click(await filtersButton())
    const panel = await screen.findByRole('region', { name: t.filtersForm.title })
    await user.click(within(panel).getByRole('checkbox', { name: es.funnels.statuses.OPEN }))
    await user.click(within(panel).getByRole('checkbox', { name: es.funnels.statuses.ON_HOLD }))
    await user.click(within(panel).getByRole('checkbox', { name: t.filtersForm.unassigned }))
    await user.type(within(panel).getByRole('textbox', { name: t.filtersForm.min }), '100')
    await user.type(within(panel).getByRole('textbox', { name: t.filtersForm.max }), '50')
    expect(within(panel).getByRole('alert')).toHaveTextContent(t.filtersForm.rangeError)
    expect(within(panel).getByRole('button', { name: t.filtersForm.apply })).toBeDisabled()
    await user.clear(within(panel).getByRole('textbox', { name: t.filtersForm.max }))
    await user.type(within(panel).getByRole('textbox', { name: t.filtersForm.max }), '2000,5')
    await user.click(within(panel).getByRole('button', { name: t.filtersForm.apply }))

    await waitFor(() => expect(boardQueries.at(-1)?.get('statuses')).toBe('OPEN,ON_HOLD'))
    const applied = boardQueries.at(-1)!
    expect(applied.get('unassigned')).toBe('true')
    expect(applied.get('minCents')).toBe('10000')
    expect(applied.get('maxCents')).toBe('200050')
    expect(applied.get('search')).toBe('ana')

    await user.click(await filtersButton())
    await user.click(
      within(await screen.findByRole('region', { name: t.filtersForm.title })).getByRole('button', {
        name: t.filtersForm.clear,
      }),
    )
    await waitFor(() => expect(boardQueries.at(-1)?.get('statuses')).toBeNull())
    expect(boardQueries.at(-1)?.get('search')).toBe('ana')
  })

  it('offers to open a contact that is already in the funnel', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await column('Nuevo')
    await user.click(screen.getByRole('button', { name: t.addLead }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: t.addLeadForm.contact }))
    await user.click(await screen.findByRole('option', { name: /Ana Pérez/ }))
    await user.click(within(dialog).getByRole('button', { name: t.addLeadForm.add }))

    expect(await within(dialog).findByText(t.addLeadForm.exists)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t.lead.open }))
    // The chat of the lead: its stage there, and no chat on the line yet.
    const chat = await screen.findByRole('dialog', { name: t.chat.title('Ana Pérez') })
    expect(await within(chat).findByText(t.chat.noChat)).toBeInTheDocument()
  })

  it('changes the stage from the lead chat', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await user.click(within(await column('Nuevo')).getByRole('button', { name: 'Ana Pérez' }))
    const chat = await screen.findByRole('dialog', { name: t.chat.title('Ana Pérez') })
    await user.click(await within(chat).findByRole('combobox', { name: 'Ventas' }))
    await user.click(await screen.findByRole('option', { name: 'En atención' }))
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({
        method: 'PUT',
        path: '/funnels/contacts/c-a',
        body: { funnelId: 'f1', stageId: 's2' },
      }),
    )
  })

  it('asks where the leads go before deleting a stage', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    const nuevo = await column('Nuevo')
    await user.click(within(nuevo).getByRole('button', { name: t.stage.menu('Nuevo') }))
    await user.click(await screen.findByRole('menuitem', { name: t.stage.remove }))
    const dialog = await screen.findByRole('dialog', { name: t.stage.removeTitle('Nuevo') })
    expect(within(dialog).getByText(t.stage.removeWithLeads(1))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: t.stage.moveTo }))
    await user.click(await screen.findByRole('option', { name: 'Cerrado' }))
    await user.click(within(dialog).getByRole('button', { name: t.stage.remove }))
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({
        method: 'DELETE',
        path: '/funnels/f1/stages/s1?moveTo=s3',
      }),
    )
  })

  it('syncs the contacts and shows what happened', async () => {
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await column('Nuevo')
    await user.click(screen.getByRole('button', { name: t.more }))
    await user.click(await screen.findByRole('menuitem', { name: t.sync }))
    const dialog = await screen.findByRole('dialog', { name: t.syncForm.title })
    await user.click(within(dialog).getByRole('button', { name: t.syncForm.run }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent(t.syncForm.result(4, 2, 0))
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      body: { rules: [{ status: 'OPEN', stageId: 's1' }] },
    })
  })

  it('downloads the board as CSV', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await column('Nuevo')
    await user.click(screen.getByRole('button', { name: t.more }))
    await user.click(await screen.findByRole('menuitem', { name: t.export }))
    expect(await screen.findByText(t.exported)).toBeInTheDocument()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('lets an agent move leads but not manage the funnel', async () => {
    me = makeMe(['funnels.read', 'funnels.write', 'messages.read'])
    renderAt('/funnels/f1')
    const user = userEvent.setup()
    await column('Nuevo')
    expect(screen.queryByRole('button', { name: t.stage.drag('Nuevo') })).toBeNull()
    expect(screen.queryByRole('button', { name: t.newFunnel })).toBeNull()
    await user.click(screen.getByRole('button', { name: t.more }))
    expect(screen.queryByRole('menuitem', { name: t.sync })).toBeNull()
    expect(screen.getByRole('menuitem', { name: t.export })).toBeInTheDocument()
  })

  it('tells when the plan does not include funnels', async () => {
    server.use(
      http.get(api(BASE), () =>
        HttpResponse.json(
          {
            statusCode: 403,
            error: 'Forbidden',
            message: 'plan',
            code: 'FEATURE_NOT_IN_PLAN',
            details: { plan: 'team' },
            timestamp: '',
          },
          { status: 403 },
        ),
      ),
    )
    renderAt('/funnels')
    expect(await screen.findByText(t.notInPlan)).toBeInTheDocument()
  })

  it('is in the menu only with funnels.read', async () => {
    renderAt('/funnels/f1')
    expect(await screen.findByRole('link', { name: es.app.nav.funnels })).toBeInTheDocument()
  })
})
