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
import { inboxApi, type ChatMessage, type Conversation } from '../lib/api/inbox'
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
let quickReplies: { id: string; shortcut: string; text: string }[]

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
      mineClosed: 0,
      unassigned: 0,
      all: 3,
      onHold: 2,
      closed: 0,
      unread: chat.unreadCount,
    }),
  ),
  http.get(api(`${base}/options`), () =>
    HttpResponse.json({
      lines: [{ id: 'l1', name: 'Ventas' }],
      members: permissions.includes('conversations.assign')
        ? [{ membershipId: 'm2', userId: 'u2', name: 'Ana Agente' }]
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
    return HttpResponse.json(chat)
  }),
  http.get(api('/workspaces/w1/quick-replies'), () => HttpResponse.json(quickReplies)),
  http.get(api('/workspaces/w1/tags'), () =>
    HttpResponse.json([
      { id: 't1', name: 'VENTAS', color: '#1565c0', description: null, contactCount: 1 },
      { id: 't2', name: 'VIP', color: '#2e7d32', description: null, contactCount: 1 },
    ]),
  ),
  http.post(api('/workspaces/w1/quick-replies'), async ({ request }) => {
    const body = (await request.json()) as { shortcut: string; text: string }
    actions.push({ name: 'quick-reply', body })
    return HttpResponse.json({ id: 'qr9', ...body, createdBy: null }, { status: 201 })
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
  it('shows the chat list with status filters and the menu entries at the top level', async () => {
    permissions = ['messages.read', 'messages.send', 'channels.manage']
    renderAt('/inbox')
    const user = userEvent.setup()

    const menu = await screen.findByRole('navigation', { name: 'menu' })
    expect(within(menu).getByRole('link', { name: /Bandeja/ })).toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: /Autoasignación/ })).toBeInTheDocument()
    expect(within(menu).queryByText('Mensajes')).not.toBeInTheDocument()

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
    // The open tab counts the chats of the current view.
    expect(within(screen.getByRole('tab', { name: 'Abierto' })).getByText('3')).toBeInTheDocument()

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

    await user.click(await screen.findByRole('button', { name: /Transferir/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Ana Agente' }))
    await waitFor(() =>
      expect(actions).toContainEqual({ name: 'assign', body: { membershipId: 'm2' } }),
    )

    await user.click(screen.getByRole('button', { name: 'Más opciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Marcar como no leído' }))
    await waitFor(() => expect(actions.map((action) => action.name)).toContain('unread'))
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
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    sendMedia.mockRestore()
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
  it('inserts a quick reply typing "/" and its shortcut', async () => {
    quickReplies = [
      { id: 'qr1', shortcut: 'saludo', text: '¡Hola! Gracias por escribirnos.' },
      { id: 'qr2', shortcut: 'horario', text: 'Atendemos de 8 a 18.' },
    ]
    renderAt()
    const user = userEvent.setup()
    const editor = await screen.findByLabelText('Escribir respuesta')

    await user.type(editor, '/sal')
    const options = await screen.findByRole('listbox', { name: 'Respuestas rápidas' })
    expect(within(options).getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(editor).toHaveValue('¡Hola! Gracias por escribirnos.')
    expect(actions).toEqual([{ name: 'read', body: null }])
  })

  it('opens the emoji picker in Spanish', async () => {
    renderAt()
    const user = userEvent.setup()
    await screen.findByLabelText('Escribir respuesta')

    await user.click(screen.getByRole('button', { name: 'Emojis' }))
    expect(await screen.findByPlaceholderText('Buscar emoji')).toBeInTheDocument()
  })

  it('creates quick replies on their page', async () => {
    permissions = ['messages.read', 'messages.send', 'quick_replies.manage']
    renderAt('/quick-replies')
    const user = userEvent.setup()

    const menu = await screen.findByRole('navigation', { name: 'menu' })
    expect(within(menu).getByRole('link', { name: /Respuestas rápidas/ })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Nueva respuesta rápida' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Atajo/), 'gracias')
    await user.type(within(dialog).getByLabelText(/Mensaje/), '¡Gracias por tu compra!')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(actions).toContainEqual({
        name: 'quick-reply',
        body: { shortcut: 'gracias', text: '¡Gracias por tu compra!' },
      }),
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
    await user.click(screen.getByRole('button', { name: 'Poner en espera' }))
    await waitFor(() => expect(actions.map((action) => action.name)).toContain('hold'))
    expect(await screen.findByRole('button', { name: 'Reabrir chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar chat' })).toBeInTheDocument()
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
      expect(sendContacts).toHaveBeenCalledWith('w1', 'c1', [
        { name: 'Técnico Juan', phone: '+591 71234567' },
      ]),
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
})
