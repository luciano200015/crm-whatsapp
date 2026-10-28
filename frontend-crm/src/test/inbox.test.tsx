import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../AppProviders'
import { API_BASE_URL } from '../lib/api/client'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import type { ChatSettingsView } from '../lib/api/chat-settings'
import { inboxApi, type ChatMessage, type Conversation } from '../lib/api/inbox'
import type { QuickReply } from '../lib/api/quick-replies'
import { outbox } from '../components/inbox/outbox'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const base = '/workspaces/w1/conversations'
let permissions: string[]
let chat: Conversation
let history: ChatMessage[]
let actions: { name: string; body: unknown }[]
let streamCount: number
let listQueries: string[]
let listUrls: URL[]
let quickReplies: QuickReply[]
let chatSettings: ChatSettingsView
let transfers: boolean
let myLines: string[]

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
    HttpResponse.json({
      mine: 1,
      mineOnHold: 0,
      mineClosed: 4,
      mineClosedUnread: 0,
      unassigned: 0,
      all: 3,
      onHold: 2,
      // Cerrado counts only the closed chats with unread messages.
      closed: 7,
      closedUnread: 1,
      unread: chat.unreadCount,
      // The tabs show unread messages, not chats.
      unreadByStatus: { OPEN: 3, ON_HOLD: 120, CLOSED: 1 },
      mineUnreadByStatus: { OPEN: 1, ON_HOLD: 0, CLOSED: 0 },
    }),
  ),
  http.get(api(`${base}/options`), () =>
    HttpResponse.json({
      transfers,
      viewAll: permissions.includes('conversations.view_all'),
      myLineIds: myLines,
      lines: [
        {
          id: 'l1',
          name: 'Ventas',
          displayPhone: '+591 70000001',
          status: 'CONNECTED',
          color: '#303f9f',
        },
      ].filter((line) => myLines.includes(line.id)),
      members:
        permissions.includes('conversations.assign') || transfers
          ? [
              {
                membershipId: 'm2',
                userId: 'u2',
                name: 'Ana Agente',
                lineIds: ['l1'],
                viewAll: false,
              },
              // Beto attends another line: chats of Ventas cannot go to him.
              {
                membershipId: 'm3',
                userId: 'u3',
                name: 'Beto Otro',
                lineIds: ['l9'],
                viewAll: false,
              },
            ]
          : [],
    }),
  ),
  http.get(api(base), ({ request }) => {
    const url = new URL(request.url)
    listQueries.push(url.searchParams.get('status') ?? '')
    listUrls.push(url)
    return HttpResponse.json({ items: [chat], nextCursor: null })
  }),
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
    if (name === 'unread') chat = { ...chat, unreadCount: 1 }
    if (name === 'close') chat = { ...chat, status: 'CLOSED' }
    if (name === 'hold') chat = { ...chat, status: 'ON_HOLD' }
    if (name === 'reopen') chat = { ...chat, status: 'OPEN' }
    if (name === 'take')
      chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    if (name === 'accept')
      chat = {
        ...chat,
        status: 'OPEN',
        assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' },
      }
    return HttpResponse.json(chat)
  }),
  http.get(api('/workspaces/w1/quick-replies'), () => HttpResponse.json(quickReplies)),
  http.post(api('/workspaces/w1/quick-replies/attachments'), () =>
    HttpResponse.json(
      { fileId: 'f1', filename: 'catalogo.pdf', mimeType: 'application/pdf', size: 2048 },
      { status: 201 },
    ),
  ),
  http.post(api(`${base}/c1/quick-replies/:replyId`), async ({ params, request }) => {
    actions.push({
      name: `send-quick-reply:${String(params.replyId)}`,
      body: await request.json(),
    })
    return HttpResponse.json([], { status: 201 })
  }),
  http.get(api('/workspaces/w1/chat-settings'), () => HttpResponse.json(chatSettings)),
  http.put(api('/workspaces/w1/chat-settings'), async ({ request }) => {
    const body = (await request.json()) as Omit<ChatSettingsView, 'legacyAssignment'>
    actions.push({ name: 'chat-settings', body })
    chatSettings = { ...body, legacyAssignment: false }
    return HttpResponse.json(chatSettings)
  }),
  http.get(api('/workspaces/w1/tags'), () =>
    HttpResponse.json([
      { id: 't1', name: 'VENTAS', color: '#1565c0', description: null, contactCount: 1 },
      { id: 't2', name: 'VIP', color: '#2e7d32', description: null, contactCount: 1 },
    ]),
  ),
  http.post(api('/workspaces/w1/quick-replies'), async ({ request }) => {
    const body = (await request.json()) as { title: string; text: string }
    actions.push({ name: 'quick-reply', body })
    return HttpResponse.json(
      { id: 'qr9', shortcut: 'x', attachments: [], ...body, createdBy: null },
      { status: 201 },
    )
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
  listQueries = []
  listUrls = []
  quickReplies = []
  transfers = false
  chatSettings = {
    assignment: { mode: 'NONE', includeAdmins: false },
    transfers: false,
    signature: 'AGENT_CHOICE',
    closeMessage: { mode: 'NEVER', text: '' },
    legacyAssignment: true,
  }
  myLines = ['l1']
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
  outbox.clear()
  server.resetHandlers()
  tokenStore.clear()
  document.cookie = 'crm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})
afterAll(() => server.close())

const quickReply = (
  id: string,
  title: string,
  text: string,
  attachments: QuickReply['attachments'] = [],
): QuickReply => ({
  id,
  title,
  shortcut: title.toLowerCase(),
  text,
  attachments,
  createdBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

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

  it('«Aceptar» takes a chat on hold and opens it', async () => {
    chat = { ...chat, status: 'ON_HOLD' }
    renderAt('/inbox')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /En espera/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Aceptar el chat con Lucía Cliente' }),
    )
    await waitFor(() => expect(actions.map((action) => action.name)).toContain('accept'))
    expect(await screen.findByText('Aceptaste el chat con Lucía Cliente')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Abierto/ })).toHaveAttribute('aria-selected', 'true'),
    )
    // Accepted: it is mine and open, so there is nothing left to accept.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Aceptar el chat con Lucía Cliente' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('offers no «Aceptar» without permission to reply', async () => {
    permissions = ['messages.read']
    chat = { ...chat, status: 'ON_HOLD' }
    renderAt('/inbox')
    await screen.findByRole('button', { name: 'Chat con Lucía Cliente' })
    expect(screen.queryByRole('button', { name: /Aceptar el chat/ })).not.toBeInTheDocument()
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

  it('configures the chat module from its settings modal', async () => {
    permissions = ['messages.read', 'channels.manage']
    renderAt('/inbox')
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Configuración del módulo de chat' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Configuración del módulo de chat' })
    // Never saved: the lines still use their own switch.
    expect(await within(dialog).findByText(/cada línea usa su propio interruptor/)).toBeVisible()

    await user.click(within(dialog).getByRole('radio', { name: /Autoasignar conversación/ }))
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Incluir a los administradores de la cuenta en la asignación de chats',
      }),
    )
    await user.click(within(dialog).getByLabelText('Ventas'))
    await user.click(await screen.findByRole('option', { name: 'Ana Agente' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Activar transferencia de chats' }))
    await user.click(
      within(dialog).getByRole('radio', { name: 'Siempre firmar todos los mensajes enviados' }),
    )
    await user.click(within(dialog).getByRole('radio', { name: /Preguntar para enviar/ }))
    // The message is required when it may be sent.
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Mensaje al cerrar'), '¡Gracias!')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(actions).toEqual([
        { name: 'agents', body: { membershipIds: ['m2'] } },
        {
          name: 'chat-settings',
          body: {
            assignment: { mode: 'LEAST_BUSY', includeAdmins: true },
            transfers: true,
            signature: 'ALWAYS',
            closeMessage: { mode: 'ASK', text: '¡Gracias!' },
          },
        },
      ]),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('shows only the alerts to agents in the settings modal', async () => {
    renderAt('/inbox')
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Configuración del módulo de chat' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Configuración del módulo de chat' })
    expect(within(dialog).getByRole('switch', { name: 'Sonido' })).toBeInTheDocument()
    expect(within(dialog).queryByText('Auto-asignación de chats')).not.toBeInTheDocument()
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
  it('shows the chat list with status filters and the menu entries at the top level', async () => {
    permissions = ['messages.read', 'messages.send', 'channels.read', 'channels.manage']
    renderAt('/inbox')
    const user = userEvent.setup()

    const menu = await screen.findByRole('navigation', { name: 'menu' })
    expect(within(menu).getByRole('link', { name: /Bandeja/ })).toBeInTheDocument()
    // Auto-assignment is in the chat settings; quick replies open from the chat.
    expect(within(menu).queryByRole('link', { name: /Autoasignación/ })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: /Respuestas rápidas/ })).not.toBeInTheDocument()
    expect(within(menu).queryByText('Mensajes')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Más opciones de la bandeja' }))
    expect(screen.queryByRole('menuitem', { name: 'Autoasignación' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Líneas de WhatsApp' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(
      await screen.findByRole('button', { name: 'Chat con Lucía Cliente' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'En espera' }))
    await user.click(screen.getByRole('tab', { name: 'Cerrado' }))
    await waitFor(() =>
      expect(listQueries).toEqual(expect.arrayContaining(['OPEN', 'ON_HOLD', 'CLOSED'])),
    )
    // No «Sin asignar» tab: unassigned chats are part of the open ones.
    expect(screen.queryByRole('tab', { name: /Sin asignar/ })).not.toBeInTheDocument()
  })

  it('switches between my chats and those of my agents and filters only when applying', async () => {
    permissions = ['messages.read', 'messages.send', 'contacts.read', 'conversations.view_all']
    renderAt('/inbox')
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Chat con Lucía Cliente' })
    expect(listUrls.at(-1)?.searchParams.get('view')).toBe('all')
    // Each tab counts the unread messages of the current view, not its chats.
    expect(within(screen.getByRole('tab', { name: 'Abierto' })).getByText('3')).toBeInTheDocument()
    expect(
      within(screen.getByRole('tab', { name: /En espera/ })).getByText('99+'),
    ).toBeInTheDocument()
    const closedTab = screen.getByRole('tab', { name: /Cerrado/ })
    expect(within(closedTab).getByText('1')).toBeInTheDocument()
    expect(within(closedTab).queryByText('7')).not.toBeInTheDocument()

    const team = screen.getByRole('button', {
      name: 'Mostrar mis conversaciones abiertas y las de mis agentes',
    })
    expect(team).toHaveAttribute('aria-pressed', 'true')
    await user.click(team)
    await waitFor(() => expect(listUrls.at(-1)?.searchParams.get('view')).toBe('mine'))

    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    const panel = await screen.findByRole('region', { name: 'Filtros de conversaciones' })
    expect(screen.queryByRole('list', { name: 'Lista de chats' })).not.toBeInTheDocument()
    await user.click(within(panel).getByLabelText('Etiquetas'))
    await user.click(await screen.findByRole('option', { name: 'VIP' }))
    await user.click(within(panel).getByLabelText('Agentes'))
    await user.click(await screen.findByRole('option', { name: 'Sin asignar' }))
    // Nothing is filtered until «Aplicar filtros».
    expect(listUrls.some((url) => url.searchParams.has('tagIds'))).toBe(false)
    await user.click(within(panel).getByRole('button', { name: /Aplicar filtros/ }))

    await waitFor(() => {
      const query = listUrls.at(-1)?.searchParams
      expect(query?.get('tagIds')).toBe('t2')
      expect(query?.get('assigneeIds')).toBe('none')
    })
    expect(await screen.findByRole('button', { name: 'Filtros (2 activos)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filtros (2 activos)' }))
    await user.click(await screen.findByRole('button', { name: /Limpiar filtros/ }))
    await waitFor(() => expect(listUrls.at(-1)?.searchParams.get('tagIds')).toBeNull())
  })

  it('shows the movements of the chat as centered notices', async () => {
    history = [
      {
        ...history[0]!,
        id: 'ev1',
        direction: 'EVENT',
        text: null,
        status: 'sent',
        event: {
          kind: 'transferred',
          by: { userId: 'u9', name: 'Olga' },
          from: { membershipId: 'm1', name: 'Uma' },
          to: { membershipId: 'm2', name: 'Ana Agente' },
        },
      },
      ...history,
    ]
    renderAt()

    expect(
      await screen.findByText(/Olga transfirió el chat de Uma a Ana Agente/),
    ).toBeInTheDocument()
    expect(screen.getByText('Hoy')).toBeInTheDocument()
  })

  it('transfers the chat to another agent and marks it as unread', async () => {
    permissions = ['messages.read', 'messages.send', 'conversations.assign']
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    renderAt()
    const user = userEvent.setup()

    // Transfer lives in the ⋮ menu; only closing stays in the header.
    await user.click(await screen.findByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transferir' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Ana Agente' }))
    expect(screen.queryByRole('menuitem', { name: 'Beto Otro' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(actions).toContainEqual({ name: 'assign', body: { membershipId: 'm2' } }),
    )

    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Marcar como no leído' }))
    await waitFor(() => expect(actions.map((action) => action.name)).toContain('unread'))
  })
  it('shows a message at once with the clock and then its tick', async () => {
    let release = () => {}
    const answered = new Promise<void>((resolve) => {
      release = resolve
    })
    let sentBody: { text: string; clientId?: string } | null = null
    server.use(
      http.post(api(`${base}/c1/messages`), async ({ request }) => {
        sentBody = (await request.json()) as { text: string; clientId?: string }
        await answered
        const message: ChatMessage = {
          ...history[0]!,
          id: 'msg-sent',
          direction: 'OUT',
          status: 'sent',
          text: sentBody.text,
          clientId: sentBody.clientId,
          sentBy: { userId: 'u1', name: 'Uma' },
        }
        history.unshift(message)
        return HttpResponse.json(message, { status: 201 })
      }),
    )
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')

    await user.type(editor, 'Ya te lo envío{Enter}')
    // Shown before the server answers, with the clock, and the editor stays free.
    expect(await screen.findByText('Ya te lo envío')).toBeInTheDocument()
    expect(screen.getByLabelText('Enviando')).toBeInTheDocument()
    expect(editor).toHaveValue('')
    expect(editor).toBeEnabled()
    await waitFor(() => expect(sentBody?.clientId).toMatch(/^[0-9a-f-]{36}$/))

    release()
    await waitFor(() => expect(screen.queryByLabelText('Enviando')).not.toBeInTheDocument())
    expect(screen.getAllByText('Ya te lo envío')).toHaveLength(1)
    expect(screen.getByLabelText('Enviado')).toBeInTheDocument()
  })

  it('keeps a message that could not be sent, to send it again or discard it', async () => {
    let refuse = true
    server.use(
      http.post(api(`${base}/c1/messages`), async ({ request }) => {
        const body = (await request.json()) as { text: string; clientId?: string }
        if (refuse) {
          return HttpResponse.json(
            { statusCode: 503, message: 'Servicio no disponible', code: 'UNAVAILABLE' },
            { status: 503 },
          )
        }
        const message: ChatMessage = {
          ...history[0]!,
          id: `msg-${history.length + 1}`,
          direction: 'OUT',
          status: 'sent',
          text: body.text,
          clientId: body.clientId,
        }
        history.unshift(message)
        return HttpResponse.json(message, { status: 201 })
      }),
    )
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')

    await user.type(editor, 'Primero{Enter}')
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument()
    refuse = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.queryByText(/No enviado/)).not.toBeInTheDocument())
    expect(screen.getByText('Primero')).toBeInTheDocument()

    refuse = true
    await user.type(editor, 'Segundo{Enter}')
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByText('Segundo')).not.toBeInTheDocument()
  })

  it('frames the chats with the color of their line', async () => {
    renderAt()
    const row = await screen.findByRole('button', { name: 'Chat con Lucía Cliente' })
    await waitFor(() => expect(row).toHaveStyle({ borderLeft: '3px solid #303f9f' }))
    expect(within(row).getByLabelText('Línea Ventas')).toHaveStyle({
      backgroundColor: '#303f9f',
    })
  })

  it('shows my WhatsApp lines in my profile', async () => {
    renderAt('/inbox')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Mi perfil' }))
    const profile = await screen.findByRole('dialog', { name: 'Mi perfil' })
    expect(within(profile).getByText('Uma')).toBeInTheDocument()
    expect(within(profile).getByText('Ventas')).toBeInTheDocument()
    expect(within(profile).getByText('+591 70000001')).toBeInTheDocument()
  })

  it('tells an agent without lines that no chat will reach them', async () => {
    myLines = []
    renderAt('/inbox')

    expect(await screen.findByText(/Aún no tienes números asignados/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Mi perfil' }))
    expect(await screen.findByText(/Aún no tienes líneas asignadas/)).toBeInTheDocument()
  })

  it('shows the files customers send', async () => {
    server.use(
      http.get(api(`${base}/c1/messages/:messageId/media`), () =>
        HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer, {
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    )
    history = [
      {
        ...history[0]!,
        id: 'img1',
        type: 'image',
        text: 'Mi pedido',
        media: { id: 'img1', mimeType: 'image/png', caption: 'Mi pedido', filename: null, size: 4 },
      },
      {
        ...history[0]!,
        id: 'doc1',
        type: 'document',
        text: null,
        media: {
          id: 'doc1',
          mimeType: 'application/pdf',
          caption: null,
          filename: 'factura.pdf',
          size: 2048,
        },
      },
    ]
    renderAt()

    expect(await screen.findByRole('img', { name: 'Mi pedido' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    )
    expect(screen.getByText('factura.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar factura.pdf' })).toBeInTheDocument()
  })

  it('sends a file with a caption and refuses types WhatsApp does not accept', async () => {
    // jsdom's FormData cannot go through Node's fetch: check the call instead.
    const sendMedia = vi
      .spyOn(inboxApi, 'sendMedia')
      .mockImplementation((_workspace, _chat, file, caption) =>
        Promise.resolve({
          ...history[0]!,
          id: 'out-img',
          direction: 'OUT',
          type: 'image',
          status: 'sent',
          text: caption,
          media: {
            id: 'out-img',
            mimeType: file.type,
            caption: null,
            filename: file.name,
            size: file.size,
          },
        }),
      )
    renderAt()
    const user = userEvent.setup({ applyAccept: false })
    await screen.findByLabelText('Escribir respuesta')

    const picker = screen.getByLabelText('Elegir archivo')
    await user.upload(picker, new File(['<b>x</b>'], 'pagina.html', { type: 'text/html' }))
    expect(await screen.findByText(/WhatsApp no acepta este tipo de archivo/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.upload(
      picker,
      new File([new Uint8Array([1, 2, 3, 4])], 'foto.png', { type: 'image/png' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Agregar un comentario'), 'Tu pedido')
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }))

    await waitFor(() =>
      expect(sendMedia).toHaveBeenCalledWith(
        'w1',
        'c1',
        expect.objectContaining({ name: 'foto.png' }),
        'Tu pedido',
        expect.any(String),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    sendMedia.mockRestore()
  })
  it('tags the chat from its header', async () => {
    permissions = ['messages.read', 'messages.send', 'contacts.read', 'contacts.write']
    server.use(
      http.get(api('/workspaces/w1/contacts/ct1'), () =>
        HttpResponse.json({
          id: 'ct1',
          phone: '+59170000001',
          name: 'Lucía Cliente',
          email: null,
          notes: null,
          tags: [],
          source: 'whatsapp',
          lastMessageAt: null,
          blocked: false,
          blockedAt: null,
          blockedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ),
      http.put(api(`${base}/c1/tags`), async ({ request }) => {
        const body = (await request.json()) as { tagIds: string[] }
        actions.push({ name: 'tags', body })
        chat = { ...chat, contactTagIds: body.tagIds }
        return HttpResponse.json(chat)
      }),
    )
    renderAt()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Etiquetar chat' }))
    const picker = await screen.findByRole('dialog', { name: 'Etiquetar chat' })
    await user.click(await within(picker).findByRole('checkbox', { name: 'VIP' }))

    await waitFor(() => expect(actions).toContainEqual({ name: 'tags', body: { tagIds: ['t2'] } }))
    await waitFor(() =>
      expect(within(picker).getByRole('checkbox', { name: 'VIP' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
    // The header shows the tag of the chat.
    await user.keyboard('{Escape}')
    const header = screen.getByRole('button', { name: 'Ver detalles' })
    expect(await within(header).findByText('VIP')).toBeInTheDocument()
  })

  it('blocks the contact from the chat and explains when WhatsApp refuses it', async () => {
    permissions = ['messages.read', 'messages.send', 'contacts.read', 'contacts.write']
    let blocked = false
    const contact = () => ({
      id: 'ct1',
      phone: '+59170000001',
      name: 'Lucía Cliente',
      email: null,
      notes: null,
      tags: [],
      source: 'whatsapp',
      lastMessageAt: null,
      blocked,
      blockedAt: null,
      blockedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    server.use(
      http.get(api('/workspaces/w1/contacts/ct1'), () => HttpResponse.json(contact())),
      http.get(api('/workspaces/w1/tags'), () => HttpResponse.json([])),
      http.post(api('/workspaces/w1/contacts/ct1/block'), () => {
        blocked = true
        return HttpResponse.json({
          blocked: true,
          whatsapp: [
            {
              lineId: 'l1',
              lineName: 'Ventas',
              ok: false,
              error: 'User must have messaged in the last 24 hours',
            },
          ],
        })
      }),
    )
    renderAt()
    const user = userEvent.setup()

    await screen.findByLabelText('Escribir respuesta')
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Bloquear contacto' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Bloquear' }))

    expect(
      await screen.findByText(/Bloqueado en el CRM. WhatsApp no lo bloqueó en «Ventas»/),
    ).toBeInTheDocument()
    expect(await screen.findAllByText('Bloqueado')).not.toHaveLength(0)
  })
  it('opens the quick replies with "/" to search, send or use one', async () => {
    quickReplies = [
      quickReply('qr1', 'Saludo', '¡Hola! Gracias por escribirnos.'),
      quickReply('qr2', 'Lavadoras monstruosas', 'Llegaron las lavadoras de 17 kilos.', [
        { fileId: 'f1', filename: 'catalogo.pdf', mimeType: 'application/pdf', size: 2048 },
      ]),
    ]
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')

    await user.type(editor, '/')
    const panel = await screen.findByRole('dialog', { name: 'Respuestas rápidas' })
    expect(editor).toHaveValue('')
    // By title or content, without accents.
    await user.type(within(panel).getByLabelText('Buscar respuesta rápida'), 'kilos')
    expect(within(panel).getAllByRole('article')).toHaveLength(1)
    expect(within(panel).getByText('catalogo.pdf (2 KB)')).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'Nueva respuesta rápida' }),
    ).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Enviar «Lavadoras monstruosas»' }))
    await waitFor(() =>
      expect(actions).toContainEqual({ name: 'send-quick-reply:qr2', body: { sign: false } }),
    )
    await waitFor(() => expect(panel).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Respuestas rápidas' }))
    await user.click(await screen.findByRole('button', { name: 'Usar «Saludo» en el mensaje' }))
    expect(editor).toHaveValue('¡Hola! Gracias por escribirnos.')
    expect(screen.queryByRole('dialog', { name: 'Respuestas rápidas' })).not.toBeInTheDocument()
  })

  it('opens the emoji picker in Spanish', async () => {
    renderAt()
    const user = userEvent.setup()
    await screen.findByLabelText('Escribir respuesta')

    await user.click(screen.getByRole('button', { name: 'Emojis' }))
    expect(await screen.findByPlaceholderText('Buscar emoji')).toBeInTheDocument()
  })

  it('creates quick replies with a file from the chat', async () => {
    permissions = ['messages.read', 'messages.send', 'quick_replies.manage']
    renderAt()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Respuestas rápidas' }))
    const panel = await screen.findByRole('dialog', { name: 'Respuestas rápidas' })
    expect(within(panel).getByText(/Crea la primera con «\+»/)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Nueva respuesta rápida' }))

    const editor = await screen.findByRole('dialog', { name: 'Edición de respuesta rápida' })
    expect(within(editor).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await user.type(within(editor).getByLabelText('Título'), 'Gracias')
    await user.type(within(editor).getByLabelText('Contenido'), '¡Gracias por tu compra!')
    await user.upload(
      within(editor).getByLabelText('Elegir archivo para adjuntar'),
      new File(['%PDF'], 'catalogo.pdf', { type: 'application/pdf' }),
    )
    expect(await within(editor).findByText('catalogo.pdf (2 KB)')).toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(actions).toContainEqual({
        name: 'quick-reply',
        body: { title: 'Gracias', text: '¡Gracias por tu compra!', attachmentIds: ['f1'] },
      }),
    )
    expect(await screen.findByRole('dialog', { name: 'Respuestas rápidas' })).toBeInTheDocument()
  })

  it('asks whether to send the closing message, and signs when the agent chooses', async () => {
    chatSettings = {
      ...chatSettings,
      closeMessage: { mode: 'ASK', text: '¡Gracias por escribirnos!' },
    }
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')

    const sign = await screen.findByRole('button', { name: 'Firmar mensajes' })
    await user.click(sign)
    expect(sign).toHaveAttribute('aria-pressed', 'true')
    await user.type(editor, 'Hola{Enter}')
    await waitFor(() =>
      expect(actions).toContainEqual({
        name: 'messages',
        body: expect.objectContaining({ text: 'Hola', sign: true }) as unknown,
      }),
    )
    await user.click(sign)

    await user.click(screen.getByRole('button', { name: 'Cerrar chat' }))
    const ask = await screen.findByRole('dialog', { name: '¿Enviar el mensaje de cierre?' })
    expect(within(ask).getByText('¡Gracias por escribirnos!')).toBeInTheDocument()
    await user.click(within(ask).getByRole('button', { name: 'Enviar y cerrar' }))
    await waitFor(() =>
      expect(actions).toContainEqual({ name: 'close', body: { sendMessage: true } }),
    )
  })

  it('lets agents transfer their own chats when transfers are on', async () => {
    transfers = true
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    renderAt()
    const user = userEvent.setup()
    await screen.findByLabelText('Escribir respuesta')
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transferir' }))
    const to = await screen.findByRole('menu', { name: 'Transferir chat a' })
    // Only admins leave a chat unassigned.
    expect(within(to).queryByText('Dejar sin asignar')).not.toBeInTheDocument()
    await user.click(within(to).getByRole('menuitem', { name: 'Ana Agente' }))
    await waitFor(() =>
      expect(actions).toContainEqual({ name: 'assign', body: { membershipId: 'm2' } }),
    )
  })

  it('does not offer transfers to agents while they are off', async () => {
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    renderAt()
    const user = userEvent.setup()
    await screen.findByLabelText('Escribir respuesta')
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    expect(await screen.findByRole('menuitem', { name: /Marcar como no leído/ })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Transferir' })).not.toBeInTheDocument()
  })

  it('does not repeat «En espera» on the cards of that tab', async () => {
    chat = { ...chat, status: 'ON_HOLD' }
    renderAt('/inbox')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /En espera/ }))
    const card = await screen.findByRole('button', { name: 'Chat con Lucía Cliente' })
    expect(within(card).queryByText('En espera')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Abierto/ }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Chat con Lucía Cliente' })).getByText(
          'En espera',
        ),
      ).toBeInTheDocument(),
    )
  })
  it('chimes and shows the unread count in the title when a customer writes', async () => {
    const oscillators: number[] = []
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect: (node: unknown) => node,
          start: () => oscillators.push(1),
          stop: () => undefined,
        }
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: (node: unknown) => node,
        }
      }
      resume() {
        return Promise.resolve()
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const incoming = { ...history[0]!, id: 'msg-new', text: 'Hola otra vez' }
    server.use(
      http.get(api(`${base}/events`), () => {
        streamCount++
        return new HttpResponse(
          `event: message.created\ndata: ${JSON.stringify({ conversation: chat, message: incoming })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }),
    )
    renderAt('/inbox')

    await waitFor(() => expect(oscillators.length).toBeGreaterThan(0))
    await waitFor(() => expect(document.title).toMatch(/^\(2\) /))
    vi.unstubAllGlobals()
  })
  it('puts the chat on hold and shows who attends each chat in the list', async () => {
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma Agente' } }
    renderAt()
    const user = userEvent.setup()

    const row = await screen.findByRole('button', { name: 'Chat con Lucía Cliente' })
    // The signed-in user's own chats say «Tú».
    expect(within(row).getByText('Tú')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Poner en espera' }))
    await waitFor(() => expect(actions.map((action) => action.name)).toContain('hold'))
    // On hold: closing stays at hand and reopening is in the menu.
    expect(await screen.findByRole('button', { name: 'Cerrar chat' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    expect(await screen.findByRole('menuitem', { name: 'Reabrir chat' })).toBeInTheDocument()
  })

  it('keeps the header to closing the chat, with the details hidden until asked for', async () => {
    permissions = ['messages.read', 'messages.send', 'conversations.assign', 'contacts.read']
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    renderAt()
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Cerrar chat' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transferir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Poner en espera' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detalles del contacto' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Ver detalles' }))
    const details = await screen.findByRole('complementary', { name: 'Detalles del contacto' })
    expect(within(details).getByText('Agente asignado')).toBeInTheDocument()

    await user.click(within(details).getByRole('button', { name: 'Cerrar detalles' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Detalles del contacto' })).toBeNull(),
    )
  })

  it('shows contact cards and the customer reopening the chat', async () => {
    history = [
      {
        ...history[0]!,
        id: 'card1',
        type: 'contacts',
        text: 'María Proveedora',
        contacts: [
          {
            name: 'María Proveedora',
            phones: [{ phone: '+591 70000999', waId: '59170000999', type: 'CELL' }],
            emails: [],
            organization: 'Proveedora SRL',
          },
        ],
      },
      {
        ...history[0]!,
        id: 'ev-reopen',
        direction: 'EVENT',
        text: null,
        event: { kind: 'reopened', by: null, from: null, to: null },
      },
      ...history,
    ]
    renderAt()

    expect(await screen.findByText('María Proveedora')).toBeInTheDocument()
    expect(screen.getByText('Proveedora SRL')).toBeInTheDocument()
    expect(screen.getByText('+591 70000999')).toBeInTheDocument()
    expect(screen.getByText(/El cliente volvió a escribir: chat reabierto/)).toBeInTheDocument()
  })

  it('sends a typed contact card', async () => {
    const sendContacts = vi.spyOn(inboxApi, 'sendContacts').mockResolvedValue({
      ...history[0]!,
      id: 'out-card',
      direction: 'OUT',
      type: 'contacts',
      status: 'sent',
    })
    renderAt()
    const user = userEvent.setup()
    await screen.findByLabelText('Escribir respuesta')

    await user.click(screen.getByRole('button', { name: 'Adjuntar archivo' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Contacto' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nombre'), 'Técnico Juan')
    await user.type(within(dialog).getByLabelText(/Teléfono/), '+591 71234567')
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }))

    await waitFor(() =>
      expect(sendContacts).toHaveBeenCalledWith(
        'w1',
        'c1',
        [{ name: 'Técnico Juan', phone: '+591 71234567' }],
        expect.any(String),
      ),
    )
    sendContacts.mockRestore()
  })

  it('explains a message WhatsApp refused and sends it again', async () => {
    chat = { ...chat, assignee: { membershipId: 'm1', userId: 'u1', name: 'Uma' } }
    history = [
      {
        ...history[0]!,
        id: 'out-failed',
        direction: 'OUT',
        text: 'Precio: 100',
        status: 'failed',
        error: '(#131005) Access denied',
        sentBy: { userId: 'u1', name: 'Uma' },
      },
      ...history,
    ]
    const retry = vi
      .spyOn(inboxApi, 'retry')
      .mockResolvedValue({ ...history[0]!, status: 'sent', error: null })
    renderAt()
    const user = userEvent.setup()

    expect(await screen.findByText(/No entregado: \(#131005\) Access denied/)).toBeInTheDocument()
    expect(screen.getByText(/Meta negó el permiso para enviar/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(retry).toHaveBeenCalledWith('w1', 'c1', 'out-failed'))
    expect(await screen.findByText('Mensaje enviado.')).toBeInTheDocument()
    retry.mockRestore()
  })

  it('shows what the bot sent and did, and lets the agent turn it off in this chat', async () => {
    const bot = { userId: 'bot:b1', name: 'Bot de ventas', kind: 'bot' as const }
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const message = (fields: Partial<ChatMessage> & { id: string }): ChatMessage => ({
      conversationId: 'c1',
      direction: 'OUT',
      type: 'text',
      text: null,
      media: null,
      status: 'sent',
      error: null,
      sentBy: bot,
      createdAt: at(1),
      ...fields,
    })
    chat = { ...chat, bot: { state: 'active', name: 'Bot de ventas', pausedBy: null } }
    // Newest first, as the API returns them.
    history = [
      message({
        id: 'm7',
        direction: 'EVENT',
        sentBy: null,
        event: {
          kind: 'bot_paused',
          by: { userId: 'u9', name: 'Beto' },
          from: null,
          to: null,
          pause: { until: null },
        },
        createdAt: at(0.5),
      }),
      message({
        id: 'm6',
        text: 'Te comunicamos con Ana Agente. En breve te atenderá.',
        createdAt: at(1),
      }),
      message({
        id: 'm5',
        direction: 'EVENT',
        sentBy: null,
        event: {
          kind: 'bot_transferred',
          by: bot,
          from: null,
          to: { membershipId: 'm2', name: 'Ana Agente' },
          pause: { until: at(-60 * 24) },
        },
        createdAt: at(2),
      }),
      message({
        id: 'm4',
        direction: 'EVENT',
        sentBy: null,
        event: {
          kind: 'bot_tagged',
          by: bot,
          from: null,
          to: null,
          tags: { added: ['VENTAS'], removed: [] },
        },
        createdAt: at(3),
      }),
      message({
        id: 'm3',
        direction: 'IN',
        status: 'received',
        sentBy: null,
        text: 'Quiero comprar',
        reply: { id: 'menu:r1', title: 'Quiero comprar' },
        createdAt: at(4),
      }),
      message({
        id: 'm2',
        type: 'interactive',
        text: '¿En qué te ayudamos?',
        interactive: {
          kind: 'list',
          header: null,
          body: '¿En qué te ayudamos?',
          footer: 'Elige una opción',
          list: {
            button: 'Ver menú',
            sections: [
              {
                title: null,
                rows: [
                  { id: 'menu:r1', title: 'Quiero comprar', description: 'Precios y stock' },
                  { id: 'menu:r2', title: 'Soporte', description: null },
                ],
              },
            ],
          },
        },
        createdAt: at(5),
      }),
      message({
        id: 'm1',
        type: 'interactive',
        text: 'Paga aquí',
        interactive: {
          kind: 'cta_url',
          header: null,
          body: 'Paga aquí',
          footer: null,
          url: { text: 'Pagar', url: 'https://pagos.example.com' },
        },
        createdAt: at(6),
      }),
    ]
    const botActions: string[] = []
    server.use(
      http.post(api(`${base}/c1/bot/:action`), async ({ params, request }) => {
        const pause = params.action === 'pause'
        const duration = pause
          ? ((await request.json()) as { duration: '24h' | 'permanent' }).duration
          : null
        botActions.push(duration ? `pause:${duration}` : String(params.action))
        chat = {
          ...chat,
          bot: {
            state: pause ? 'paused' : 'active',
            name: 'Bot de ventas',
            pausedBy: pause ? { userId: 'u1', name: 'Uma' } : null,
            pausedUntil:
              duration === '24h' ? new Date(Date.now() + 24 * 3_600_000).toISOString() : null,
          },
        }
        return HttpResponse.json(chat)
      }),
    )
    renderAt()
    const user = userEvent.setup()
    const log = await screen.findByLabelText('Historial de mensajes')

    // Interactive messages show their options, never "Archivo no disponible".
    expect(await within(log).findByText('¿En qué te ayudamos?')).toBeInTheDocument()
    expect(within(log).queryByText(/no disponible/)).not.toBeInTheDocument()
    expect(within(log).getByRole('link', { name: 'Pagar' })).toHaveAttribute(
      'href',
      'https://pagos.example.com',
    )
    await user.click(within(log).getByRole('button', { name: 'Ver menú' }))
    expect(within(log).getByText('Precios y stock')).toBeInTheDocument()
    expect(within(log).getAllByText('🤖 Bot de ventas').length).toBeGreaterThan(0)

    // What the customer chose and what the bot did.
    expect(within(log).getByText('Eligió una opción')).toBeInTheDocument()
    expect(within(log).getByText(/🤖 Bot de ventas agregó la etiqueta VENTAS/)).toBeInTheDocument()
    expect(
      within(log).getByText(
        /🤖 Bot de ventas delegó el chat a Ana Agente \(bot desactivado por 24 horas\)/,
      ),
    ).toBeInTheDocument()
    expect(
      within(log).getByText(/Beto desactivó el bot en este chat permanentemente/),
    ).toBeInTheDocument()
    expect(
      within(log).getByText('Te comunicamos con Ana Agente. En breve te atenderá.'),
    ).toBeInTheDocument()

    expect(screen.getByText('🤖 Bot activo')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Lista de chats' })
    expect(within(list).queryByRole('img', { name: /Bot desactivado/ })).not.toBeInTheDocument()

    // Off for a day: the chip and the orange robot on the avatar say how long.
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Desactivar bot por 24 horas' }))
    await waitFor(() => expect(botActions).toEqual(['pause:24h']))
    expect(await screen.findByText(/🤖 Bot off · 2[34] h/)).toBeInTheDocument()
    expect(
      await within(list).findByRole('img', {
        name: /^Bot desactivado por 24 horas por Uma · vuelve en 2[34] h/,
      }),
    ).toBeInTheDocument()

    // From a day to for good.
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Desactivar bot permanentemente' }),
    )
    await waitFor(() => expect(botActions).toEqual(['pause:24h', 'pause:permanent']))
    expect(await screen.findByText('🤖 Bot off permanente')).toBeInTheDocument()
    expect(
      await within(list).findByRole('img', { name: 'Bot desactivado permanentemente por Uma' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    expect(
      screen.queryByRole('menuitem', { name: 'Desactivar bot permanentemente' }),
    ).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Activar bot' }))
    await waitFor(() => expect(botActions).toEqual(['pause:24h', 'pause:permanent', 'resume']))
    expect(await screen.findByText('🤖 Bot activo')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(list).queryByRole('img', { name: /Bot desactivado/ })).not.toBeInTheDocument(),
    )
  })
})
