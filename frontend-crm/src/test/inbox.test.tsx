import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { API_BASE_URL } from '../lib/api/client'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import type { ChatMessage, Conversation } from '../lib/api/inbox'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const base = '/workspaces/w1/conversations'
let permissions: string[]
let chat: Conversation
let history: ChatMessage[]
let actions: { name: string; body: unknown }[]
let streamCount: number

const me = (): Me => ({
  id: 'u1',
  email: 'user@example.com',
  displayName: 'Uma',
  status: 'ACTIVE',
  emailVerified: true,
  mustChangePassword: false,
  avatarUrl: null,
  locale: null,
  timezone: null,
  createdAt: '2026-10-19T00:00:00Z',
  lastLoginAt: null,
  workspaces: [
    {
      id: 'w1',
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      roles: [{ id: 'r1', key: 'AGENT', name: 'Agente', system: true }],
      permissions,
      plan: null,
    },
  ],
})

const server = setupServer(
  http.post(api('/auth/refresh'), () =>
    HttpResponse.json({ accessToken: 'jwt', expiresIn: 900, tokenType: 'Bearer' }),
  ),
  http.get(api('/users/me'), () => HttpResponse.json(me())),
  http.get(api(`${base}/events`), () => {
    streamCount++
    return new HttpResponse('event: ping\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }),
  http.get(api(`${base}/counts`), () =>
    HttpResponse.json({ mine: 1, unassigned: 0, all: 1, unread: chat.unreadCount }),
  ),
  http.get(api(`${base}/options`), () =>
    HttpResponse.json({
      lines: [{ id: 'l1', name: 'Ventas' }],
      members: permissions.includes('conversations.assign')
        ? [{ membershipId: 'm2', userId: 'u2', name: 'Ana Agente' }]
        : [],
    }),
  ),
  http.get(api(base), () => HttpResponse.json({ items: [chat], nextCursor: null })),
  http.get(api(`${base}/c1`), () => HttpResponse.json(chat)),
  http.get(api(`${base}/c1/messages`), () =>
    HttpResponse.json({ items: history, nextCursor: null }),
  ),
  http.post(api(`${base}/c1/:action`), async ({ params, request }) => {
    const name = String(params.action)
    const body: unknown = await request
      .text()
      .then((text) => (text ? (JSON.parse(text) as unknown) : null))
    actions.push({ name, body })
    if (name === 'messages' || name === 'notes') {
      const message: ChatMessage = {
        ...history[0]!,
        id: `msg${history.length + 1}`,
        direction: name === 'notes' ? 'NOTE' : 'OUT',
        status: 'sent',
        text: (body as { text: string }).text,
      }
      history.unshift(message)
      return HttpResponse.json(message, { status: 201 })
    }
    if (name === 'read') chat = { ...chat, unreadCount: 0 }
    if (name === 'close') chat = { ...chat, status: 'CLOSED' }
    if (name === 'reopen') chat = { ...chat, status: 'OPEN' }
    if (name === 'take')
      chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    return HttpResponse.json(chat)
  }),
  http.get(api('/workspaces/w1/channels/auto-assignment'), () =>
    HttpResponse.json({
      lines: [
        { id: 'l1', name: 'Ventas', status: 'CONNECTED', autoAssign: false, membershipIds: [] },
      ],
      members: [{ membershipId: 'm2', userId: 'u2', name: 'Ana Agente' }],
    }),
  ),
  http.put(api('/workspaces/w1/channels/lines/l1/agents'), async ({ request }) => {
    actions.push({ name: 'agents', body: await request.json() })
    return HttpResponse.json({})
  }),
  http.patch(api('/workspaces/w1/channels/lines/l1'), async ({ request }) => {
    actions.push({ name: 'line', body: await request.json() })
    return HttpResponse.json({})
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  document.cookie = 'crm_csrf=abc; path=/'
  permissions = ['messages.read', 'messages.send']
  actions = []
  streamCount = 0
  chat = {
    id: 'c1',
    lineId: 'l1',
    lineName: 'Ventas',
    contactId: 'ct1',
    contact: { name: 'Lucía Cliente', phone: '+59170000001' },
    status: 'OPEN',
    assignee: null,
    lastMessage: {
      text: 'Hola equipo',
      type: 'text',
      direction: 'IN',
      at: new Date().toISOString(),
    },
    lastActivityAt: new Date().toISOString(),
    lastInboundAt: new Date().toISOString(),
    windowOpen: true,
    windowExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    unreadCount: 2,
    createdAt: new Date().toISOString(),
    closedAt: null,
  }
  history = [
    {
      id: 'msg1',
      conversationId: 'c1',
      direction: 'IN',
      type: 'text',
      text: 'Hola equipo',
      media: null,
      status: 'received',
      error: null,
      sentBy: null,
      createdAt: new Date().toISOString(),
    },
  ]
})
afterEach(() => {
  server.resetHandlers()
  tokenStore.clear()
  document.cookie = 'crm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})
afterAll(() => server.close())

function renderAt(path = '/inbox?conversation=c1') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

describe('Inbox', () => {
  it('shows permitted menus and replies, notes, take, close and reopen', async () => {
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')
    expect(screen.queryByRole('tab', { name: /Todos/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Asignar conversación')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tomar chat' }))
    await user.type(editor, 'Gracias por escribirnos')
    await user.click(screen.getByRole('button', { name: 'Enviar respuesta' }))
    expect(await screen.findByText('Gracias por escribirnos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nota interna' }))
    await user.type(screen.getByLabelText('Escribir nota interna'), 'Cliente interesado')
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }))
    expect(await screen.findByText('Cliente interesado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cerrar chat' }))
    await user.click(await screen.findByRole('button', { name: 'Reabrir chat' }))
    expect(await screen.findByRole('button', { name: 'Cerrar chat' })).toBeInTheDocument()
    expect(actions.map((action) => action.name)).toEqual(
      expect.arrayContaining(['read', 'take', 'messages', 'notes', 'close', 'reopen']),
    )
  })

  it('blocks expired replies while allowing internal notes', async () => {
    chat.windowExpiresAt = new Date(Date.now() - 1000).toISOString()
    renderAt()
    expect(await screen.findByLabelText('Escribir respuesta')).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nota interna' }))
    expect(screen.getByLabelText('Escribir nota interna')).toBeEnabled()
  })

  it('redirects without page permission and hides the message group', async () => {
    permissions = []
    const router = renderAt()
    await waitFor(() => expect(router.state.location.pathname).toBe('/forbidden'))
    const menu = await screen.findByRole('navigation', { name: 'menu' })
    expect(within(menu).queryByText('Mensajes')).not.toBeInTheDocument()
    expect(streamCount).toBe(0)
  })

  it('allows read-only chat inspection without composer', async () => {
    permissions = ['messages.read']
    renderAt()
    expect(
      await screen.findByText('Solo tienes permiso para consultar mensajes.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Escribir respuesta')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tomar chat' })).not.toBeInTheDocument()
  })

  it('configures auto-assignment with channels.manage alone', async () => {
    permissions = ['channels.manage']
    renderAt('/inbox/auto-assignment')
    const user = userEvent.setup()
    expect(await screen.findByText(/Sin agentes activos/)).toBeInTheDocument()
    await user.click(screen.getByLabelText('Asignar automáticamente nuevos chats'))
    await user.click(screen.getByLabelText('Agentes de la línea'))
    await user.click(await screen.findByRole('option', { name: 'Ana Agente' }))
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    await waitFor(() =>
      expect(actions).toEqual([
        { name: 'agents', body: { membershipIds: ['m2'] } },
        { name: 'line', body: { autoAssign: true } },
      ]),
    )
  })

  it('removes chat content after server denies further access', async () => {
    renderAt()
    expect(await screen.findByLabelText('Escribir respuesta')).toBeInTheDocument()
    server.use(
      http.get(api(`${base}/c1`), () => HttpResponse.json({ message: 'Denied' }, { status: 404 })),
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tomar chat' }))
    expect(
      await screen.findByText('Esta conversación ya no está disponible para ti.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Escribir respuesta')).not.toBeInTheDocument()
  })

  it('reconnects the event stream and refreshes revoked permissions', async () => {
    const router = renderAt()
    expect(await screen.findByLabelText('Escribir respuesta')).toBeInTheDocument()
    await waitFor(() => expect(streamCount).toBeGreaterThan(0))
    permissions = []
    server.use(http.get(api(`${base}/events`), () => new HttpResponse(null, { status: 403 })))
    await waitFor(() => expect(router.state.location.pathname).toBe('/forbidden'), {
      timeout: 5000,
    })
    expect(screen.queryByLabelText('Escribir respuesta')).not.toBeInTheDocument()
  })

  it('clears the selected chat when switching to a workspace without message permission', async () => {
    server.use(
      http.get(api('/users/me'), () => {
        const user = me()
        user.workspaces.push({
          ...user.workspaces[0]!,
          id: 'w2',
          name: 'Globex',
          slug: 'globex',
          permissions: [],
        })
        return HttpResponse.json(user)
      }),
    )
    const router = renderAt()
    expect(await screen.findByLabelText('Escribir respuesta')).toBeInTheDocument()
    const user = userEvent.setup()
    const selects = screen.getAllByRole('combobox')
    const workspace = selects.find((select) => select.textContent?.includes('Acme'))
    expect(workspace).toBeDefined()
    await user.click(workspace!)
    await user.click(await screen.findByRole('option', { name: /Globex/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/forbidden'))
    expect(screen.queryByLabelText('Escribir respuesta')).not.toBeInTheDocument()
  })
})
