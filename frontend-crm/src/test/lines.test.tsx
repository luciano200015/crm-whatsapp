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
import type { Line, Me } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const LINES = '/workspaces/w1/channels/lines'

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

const line = (withWebhook: boolean): Line => ({
  id: 'l1',
  name: 'Ventas',
  provider: 'WHATSAPP_CLOUD',
  phoneNumberId: '106540352242922',
  wabaId: null,
  displayPhone: '+591 71234567',
  verifiedName: 'Acme',
  status: 'CONNECTED',
  lastError: null,
  lastWebhookAt: null,
  autoAssign: true,
  color: null,
  agents: [
    {
      membershipId: 'm1',
      userId: 'u2',
      displayName: 'Andrés Agente',
      email: 'agent@example.com',
      status: 'ACTIVE',
    },
  ],
  accessTokenLast4: 'abcd',
  accessTokenExpiresAt: null,
  webhook: withWebhook
    ? { url: 'https://api.example.com/api/v1/webhooks/whatsapp/l1', verifyToken: 'verify-123' }
    : null,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
})

let me: Me
let lines: Line[]
let posted: unknown[]

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
  http.get(api(LINES), () => HttpResponse.json(lines)),
  http.get(api('/workspaces/w1/members'), () =>
    HttpResponse.json({ items: [], total: 0, usage: { activeMembers: 1, limit: null } }),
  ),
  http.post(api(LINES), async ({ request }) => {
    posted.push(await request.json())
    return HttpResponse.json(line(true), { status: 201 })
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
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  )
}

describe('Channels → Lines', () => {
  it('shows the line, its agents and the webhook values to paste in Meta', async () => {
    me = makeMe(['channels.read', 'channels.manage', 'members.read'])
    lines = [line(true)]
    renderAt('/channels/lines')

    expect(await screen.findByText('Ventas')).toBeInTheDocument()
    expect(screen.getByText(es.lines.status.CONNECTED)).toBeInTheDocument()
    expect(screen.getByText('Andrés Agente')).toBeInTheDocument()
    expect(screen.getByDisplayValue('verify-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: es.lines.test })).toBeInTheDocument()
  })

  it('colors a line from its card', async () => {
    me = makeMe(['channels.read', 'channels.manage'])
    lines = [line(true)]
    const patched: unknown[] = []
    server.use(
      http.patch(api(`${LINES}/l1`), async ({ request }) => {
        const body = (await request.json()) as { color: string }
        patched.push(body)
        lines = [{ ...line(true), color: body.color }]
        return HttpResponse.json(lines[0])
      }),
    )
    renderAt('/channels/lines')
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', {
        name: `${es.lines.color} de Ventas: ${es.lines.noColor}`,
      }),
    )
    const picker = await screen.findByRole('dialog', { name: `${es.lines.color} de Ventas` })
    await user.click(within(picker).getByRole('button', { name: '#303f9f' }))
    await user.click(within(picker).getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => expect(patched).toEqual([{ color: '#303f9f' }]))
    expect(
      await screen.findByRole('button', { name: `${es.lines.color} de Ventas: #303f9f` }),
    ).toBeInTheDocument()
  })

  it('connects a number with its credentials', async () => {
    me = makeMe(['channels.read', 'channels.manage'])
    lines = []
    renderAt('/channels/lines')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.lines.newLine }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre de la línea/), 'Soporte')
    await user.type(within(dialog).getByLabelText(/^Phone Number ID/), '106540352242922')
    await user.type(
      within(dialog).getByLabelText(/Token de acceso/),
      'EAAG-permanent-token-0123456789',
    )
    await user.type(
      within(dialog).getByLabelText(/^App Secret/),
      '0123456789abcdef0123456789abcdef',
    )
    await user.click(within(dialog).getByRole('button', { name: es.lines.form.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        {
          name: 'Soporte',
          phoneNumberId: '106540352242922',
          wabaId: null,
          displayPhone: null,
          accessToken: 'EAAG-permanent-token-0123456789',
          appSecret: '0123456789abcdef0123456789abcdef',
        },
      ]),
    )
  })

  it('refuses an App Secret that is not the 32 characters from Meta', async () => {
    me = makeMe(['channels.read', 'channels.manage'])
    lines = []
    renderAt('/channels/lines')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.lines.newLine }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre de la línea/), 'Soporte')
    await user.type(within(dialog).getByLabelText(/^Phone Number ID/), '106540352242922')
    await user.type(
      within(dialog).getByLabelText(/Token de acceso/),
      'EAAG-permanent-token-0123456789',
    )
    await user.type(
      within(dialog).getByLabelText(/^App Secret/),
      'aVerifyTokenInsteadOfTheAppSecret0000000000',
    )
    await user.click(within(dialog).getByRole('button', { name: es.lines.form.save }))

    expect(await within(dialog).findByText(es.lines.form.appSecretInvalid)).toBeInTheDocument()
    expect(posted).toEqual([])
  })

  it('is read-only without channels.manage', async () => {
    me = makeMe(['channels.read'])
    lines = [line(false)]
    renderAt('/channels/lines')

    expect(await screen.findByText('Ventas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: es.lines.newLine })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: es.lines.test })).not.toBeInTheDocument()
    expect(screen.queryByText(es.lines.webhookTitle)).not.toBeInTheDocument()
  })
})
