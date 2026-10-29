import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { es } from '../i18n/es'
import type {
  BotVariable,
  Chatbot,
  ChatbotChanges,
  ChatbotSummary,
  FlowGraph,
  NodeData,
} from '../lib/api/chatbots'
import { API_BASE_URL } from '../lib/api/client'
import type { FunnelSummary } from '../lib/api/funnels'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

// React Flow measures its nodes: jsdom has no layout, so give every element a size.
class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    const contentRect = { x: 0, y: 0, width: 800, height: 600 } as DOMRectReadOnly
    this.callback(
      [{ target, contentRect } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnlyMock {
  m22 = 1
}
Object.assign(globalThis, {
  ResizeObserver: ResizeObserverMock,
  DOMMatrixReadOnly: DOMMatrixReadOnlyMock,
})
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 60 },
  offsetWidth: { configurable: true, get: () => 240 },
})

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const BOTS = '/workspaces/w1/chatbots'

const me: Me = {
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
      permissions: [
        'chatbots.manage',
        'members.read',
        'contacts.read',
        'channels.read',
        'funnels.read',
      ],
      plan: null,
    },
  ],
}

/** A «Respuesta» as the API returns it. */
const reply = (text: string, changes: Partial<NodeData['message']> = {}): NodeData['message'] => ({
  text,
  attachments: [],
  options: [],
  listButton: '',
  header: '',
  footer: '',
  invalidText: '',
  ...changes,
})

/**
 * Inicio → menu (Ventas / Soporte); Ventas → transfer. The menu is a
 * «Botones» card saved before «Respuesta»: the editor opens it as one.
 */
const menuGraph = (): FlowGraph =>
  ({
    nodes: [
      { id: 'start', type: 'start', title: '', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'menu',
        type: 'buttons',
        title: '',
        position: { x: 0, y: 150 },
        data: {
          header: '',
          body: '¿Qué necesitas?',
          footer: '',
          buttons: [
            { id: 'sales', title: 'Ventas' },
            { id: 'help', title: 'Soporte' },
          ],
          invalidText: 'Elige una opción',
          attachments: [],
        },
      },
      {
        id: 'agent',
        type: 'transfer',
        title: 'Pasar a Ana',
        position: { x: 0, y: 350 },
        data: { to: 'member', membershipId: 'm2' },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', sourceHandle: 'next', target: 'menu' },
      { id: 'e2', source: 'menu', sourceHandle: 'sales', target: 'agent' },
      // The old "otra respuesta" output of menus: dropped by the editor.
      { id: 'e3', source: 'menu', sourceHandle: 'other', target: 'agent' },
    ],
  }) as unknown as FlowGraph

/** Inicio → greeting that waits → "1" opens Ventas; "precios" opens Precios from anywhere. */
const textMenuGraph = (): FlowGraph => ({
  nodes: [
    { id: 'start', type: 'start', title: '', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'hello',
      type: 'message',
      title: 'Saludo',
      position: { x: 0, y: 150 },
      data: reply('Escribe 1 para ventas', { wait: true }),
    },
    {
      id: 'sales',
      type: 'message',
      title: 'Ventas',
      trigger: '1, ventas',
      position: { x: 0, y: 300 },
      data: reply('Te paso con ventas'),
    },
    {
      id: 'help',
      type: 'message',
      title: 'Soporte',
      trigger: '2',
      position: { x: 300, y: 300 },
      data: reply('Cuéntanos'),
    },
    {
      id: 'prices',
      type: 'message',
      title: 'Precios',
      position: { x: 600, y: 300 },
      data: reply('Desde 10 USD'),
    },
  ],
  edges: [
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'hello' },
    { id: 'e2', source: 'hello', sourceHandle: 'next', target: 'sales' },
    { id: 'e3', source: 'hello', sourceHandle: 'next', target: 'help' },
  ],
})

const summary = (changes: Partial<ChatbotSummary> = {}): ChatbotSummary => ({
  id: 'b1',
  name: 'Bot de ventas',
  description: '',
  enabled: false,
  lines: [{ id: 'l1', name: 'Ventas' }],
  errors: 0,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  ...changes,
})

const chatbot = (graph = menuGraph(), variables: BotVariable[] = []): Chatbot => ({
  ...summary(),
  graph,
  schedule: null,
  restartAfterMinutes: 30,
  fallbackText: 'Mensaje inválido. Por favor escoge una de las opciones.',
  restartKeywords: ['menu'],
  inactivityMinutes: null,
  inactivityText: '',
  variables,
  contactVariables: ['nombre', 'apellido', 'nombre_completo', 'email', 'telefono'],
  issues: [],
})

const funnel = (id: string, name: string, lineId: string): FunnelSummary => ({
  id,
  name,
  description: '',
  lineId,
  lineName: lineId === 'l1' ? 'Línea Ventas' : 'Línea Soporte',
  isPrimary: false,
  archiveAfterDays: null,
  leads: 0,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
})

let bots: ChatbotSummary[]
let patched: ChatbotChanges[]
let created: string[]
let simulated: { text: string | null; replyId: string | null }[]
let tested: unknown[]

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
  http.get(api('/workspaces/w1/tags'), () => HttpResponse.json([])),
  http.get(api('/workspaces/w1/contact-fields'), () =>
    HttpResponse.json([{ id: 'cf1', key: 'plan', label: 'Plan', type: 'TEXT', options: [] }]),
  ),
  http.post(api(`${BOTS}/test-request`), async ({ request }) => {
    tested.push(await request.json())
    return HttpResponse.json({
      ok: true,
      status: 200,
      error: null,
      body: '{"data":{"saldo":50}}',
      values: [{ variable: 'saldo', value: '50' }],
    })
  }),
  http.get(api('/workspaces/w1/channels/lines'), () => HttpResponse.json([])),
  http.get(api('/workspaces/w1/members'), () =>
    HttpResponse.json({
      items: [
        {
          id: 'm2',
          userId: 'u2',
          displayName: 'Ana Agente',
          email: 'ana@example.com',
          status: 'ACTIVE',
          roles: [],
          createdAt: '2026-10-19T00:00:00.000Z',
        },
      ],
      total: 1,
      usage: { activeMembers: 2, limit: null },
    }),
  ),
  http.get(api('/workspaces/w1/funnels'), () =>
    HttpResponse.json([funnel('f1', 'Ventas', 'l1'), funnel('f2', 'Soporte', 'l2')]),
  ),
  http.get(api('/workspaces/w1/funnels/:id'), ({ params }) =>
    HttpResponse.json({
      ...funnel(params.id as string, params.id === 'f1' ? 'Ventas' : 'Soporte', 'l1'),
      stages: [
        { id: 's1', name: 'Nuevo', position: 0 },
        { id: 's2', name: 'En atención', position: 1 },
      ],
      syncRules: [],
    }),
  ),
  http.get(api(BOTS), () => HttpResponse.json(bots)),
  http.post(api(BOTS), async ({ request }) => {
    const { name } = (await request.json()) as { name: string }
    created.push(name)
    return HttpResponse.json({ ...chatbot(), id: 'b2', name }, { status: 201 })
  }),
  http.get(api(`${BOTS}/:id`), ({ params }) =>
    HttpResponse.json({ ...chatbot(), id: params.id as string }),
  ),
  http.patch(api(`${BOTS}/:id`), async ({ request }) => {
    const body = (await request.json()) as (typeof patched)[number]
    patched.push(body)
    const current = bots[0] ?? summary()
    return HttpResponse.json({
      ...chatbot(body.graph, body.variables),
      ...body,
      enabled: body.enabled ?? current.enabled,
    })
  }),
  http.post(api(`${BOTS}/simulate`), async ({ request }) => {
    const body = (await request.json()) as { text: string | null; replyId: string | null }
    simulated.push(body)
    if (body.replyId === 'menu:sales') {
      return HttpResponse.json({
        actions: [
          {
            kind: 'transfer',
            to: 'member',
            membershipId: 'm2',
            message: 'Te comunicamos con {{agente}}. En breve te atenderá.',
            pause: 'permanent',
          },
        ],
        session: null,
      })
    }
    return HttpResponse.json({
      actions: [
        {
          kind: 'send',
          message: {
            kind: 'interactive',
            content: {
              kind: 'buttons',
              header: null,
              body: '¿Qué necesitas?',
              footer: null,
              buttons: [
                { id: 'menu:sales', title: 'Ventas' },
                { id: 'menu:help', title: 'Soporte' },
              ],
            },
          },
        },
      ],
      session: { nodeId: 'menu', vars: {}, attempts: 0 },
    })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  bots = [summary()]
  patched = []
  created = []
  simulated = []
  tested = []
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

type User = ReturnType<typeof userEvent.setup>

/** «Agregar nodo» → a widget of the palette; returns its side panel. */
async function addNode(user: User, label: string) {
  await user.click(await screen.findByRole('button', { name: es.chatbots.editor.addNode }))
  const palette = await screen.findByRole('dialog', { name: es.chatbots.editor.palette })
  await user.click(within(palette).getByRole('button', { name: new RegExp(`^${label}`) }))
  return screen.findByLabelText(es.chatbots.editor.editNode)
}

/** «Actualizar»: the panel's changes go to the canvas. */
async function apply(user: User, editor: HTMLElement) {
  await user.click(within(editor).getByRole('button', { name: es.chatbots.editor.update }))
}

describe('Chatbots', () => {
  it('lists the bots with their lines, turns one on and creates another', async () => {
    const router = renderAt('/automation/chatbots')
    const user = userEvent.setup()
    const card = await screen.findByLabelText('Bot de ventas')
    expect(within(card).getByText('Ventas')).toBeInTheDocument()

    bots = [summary({ enabled: true })]
    await user.click(within(card).getByLabelText(`${es.chatbots.active}: Bot de ventas`))
    await waitFor(() => expect(patched).toEqual([{ enabled: true }]))
    expect(await screen.findByText(es.chatbots.enabledNow)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: es.chatbots.newBot }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Bot de soporte')
    await user.click(within(dialog).getByRole('button', { name: es.chatbots.form.create }))
    await waitFor(() => expect(created).toEqual(['Bot de soporte']))
    await waitFor(() => expect(router.state.location.pathname).toBe('/automation/chatbots/b2'))
  })

  it('removes a connection with its ✕ and keeps both cards', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    const remove = await screen.findAllByRole('button', { name: es.chatbots.editor.removeEdge })
    expect(remove).toHaveLength(2)

    await user.click(remove[1]!)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: es.chatbots.editor.removeEdge })).toHaveLength(
        1,
      ),
    )
    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const saved = patched[0]!.graph!
    expect(saved.nodes.map((node) => node.id)).toEqual(['start', 'menu', 'agent'])
    expect(saved.edges).toEqual([
      { id: 'e1', source: 'start', sourceHandle: 'next', target: 'menu' },
    ])
  })

  it('tells the customer who got the chat after a transfer, and leaves a note for the agent', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    const editor = await addNode(user, es.chatbots.nodes.transfer.label)
    const message = within(editor).getByLabelText(es.chatbots.node.transferMessage)
    expect(message).toHaveValue(es.chatbots.node.transferMessageDefault)
    await user.clear(message)
    await user.type(message, 'Ya te atiende {{{{agente}}')
    await user.type(
      within(editor).getByLabelText(es.chatbots.node.transferNote),
      'Quiere el plan anual',
    )
    await apply(user, editor)

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const added = patched[0]!.graph!.nodes.at(-1)!
    expect(added).toMatchObject({
      type: 'transfer',
      data: {
        to: 'auto',
        membershipId: null,
        message: 'Ya te atiende {{agente}}',
        note: 'Quiere el plan anual',
      },
    })
  })

  it('puts the contact in a funnel stage, with the funnels of its lines first', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    const editor = await addNode(user, es.chatbots.nodes.funnel.label)
    const pickFunnel = async (name: string) => {
      await user.click(within(editor).getByRole('combobox', { name: es.chatbots.node.funnel }))
      const listbox = await screen.findByRole('listbox')
      return { listbox, pick: () => user.click(within(listbox).getByRole('option', { name })) }
    }
    const first = await pickFunnel('Soporte · Línea Soporte')
    await waitFor(() =>
      expect(
        within(first.listbox)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual([
        'Ventas · Línea Ventas',
        es.chatbots.node.funnelOtherLine,
        'Soporte · Línea Soporte',
      ]),
    )
    await first.pick()
    expect(within(editor).getByText(es.chatbots.node.funnelOtherLineWarning)).toBeInTheDocument()

    await (await pickFunnel('Ventas · Línea Ventas')).pick()
    expect(within(editor).queryByText(es.chatbots.node.funnelOtherLineWarning)).toBeNull()
    await user.click(within(editor).getByRole('combobox', { name: es.chatbots.node.funnelStage }))
    await user.click(await screen.findByRole('option', { name: 'En atención' }))
    await apply(user, editor)

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]!.graph!.nodes.at(-1)).toMatchObject({
      type: 'funnel',
      data: { funnelId: 'f1', stageId: 's2' },
    })
  })

  it('tries the flow: taps a button and reads the handover message', async () => {
    renderAt('/automation/chatbots/b1?probar=1')
    const user = userEvent.setup()
    const tester = await screen.findByRole('dialog', { name: es.chatbots.tester.title })
    await user.type(within(tester).getByLabelText(es.chatbots.tester.placeholder), 'hola{Enter}')
    await user.click(await within(tester).findByRole('button', { name: 'Ventas' }))

    expect(
      await within(tester).findByText('Te comunicamos con Ana Agente. En breve te atenderá.'),
    ).toBeInTheDocument()
    expect(
      within(tester).getByText(
        /Transferiría el chat a Ana Agente y el bot quedaría desactivado en ese chat de forma permanente/,
      ),
    ).toBeInTheDocument()
    expect(within(tester).getByText(es.chatbots.tester.ended)).toBeInTheDocument()
    expect(simulated.map((input) => input.replyId)).toEqual([null, 'menu:sales'])
    // The test uses the bot's settings too.
    expect(simulated[0]).toMatchObject({ restartKeywords: ['menu'], variables: [] })
  })

  it('opens an old menu as a «Respuesta»: 4 options only ask for the name of the list', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    // A titled card shows its title; the rest their kind.
    expect(await screen.findByText('Pasar a Ana')).toBeInTheDocument()
    expect(screen.queryByText('Otra respuesta')).not.toBeInTheDocument()
    // The card after a button says which one opens it.
    expect(screen.getByText(es.chatbots.node.userMessage)).toBeInTheDocument()
    expect(screen.getByText(es.chatbots.node.buttonsBox)).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: `${es.chatbots.editor.editNode}: ${es.chatbots.nodes.message.label}`,
        hidden: true,
      }),
    )
    const editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    expect(within(editor).getByText(es.chatbots.nodes.message.guide)).toBeInTheDocument()
    await user.type(within(editor).getByLabelText(es.chatbots.node.title), 'Menú principal')
    expect(within(editor).getByLabelText(es.chatbots.node.button(1))).toHaveValue('Ventas')
    expect(within(editor).getByLabelText(es.chatbots.node.button(2))).toHaveValue('Soporte')
    // Up to 3 they are buttons: nothing else to fill.
    expect(within(editor).queryByLabelText(es.chatbots.node.listButton)).toBeNull()
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.addButton }))
    expect(within(editor).queryByLabelText(es.chatbots.node.listButton)).toBeNull()
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.addButton }))
    // The 4th: a list, named by its button. No sections, no descriptions.
    expect(within(editor).getByText(es.chatbots.node.asList)).toBeInTheDocument()
    await user.type(within(editor).getByLabelText(es.chatbots.node.listButton), 'Ver menú')
    expect(within(editor).queryByText(/sección/i)).toBeNull()

    // "Agregar variable" puts {{nombre}} in the bot's reply.
    const replyField = within(editor).getByRole('textbox', { name: es.chatbots.node.botReply })
    await user.clear(replyField)
    await user.type(replyField, 'Hola ')
    const insert = within(editor).getAllByRole('button', { name: es.chatbots.variables.insert })
    await user.click(insert[0]!)
    await user.click(await screen.findByRole('menuitem', { name: /^Nombre\s*\{\{nombre\}\}/ }))
    expect(replyField).toHaveValue('Hola {{nombre}}')
    await apply(user, editor)
    expect(await screen.findByText(es.chatbots.node.listName('Ver menú'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const menu = patched[0]!.graph!.nodes.find((node) => node.id === 'menu')!
    expect(menu).toMatchObject({
      type: 'message',
      title: 'Menú principal',
      data: {
        text: 'Hola {{nombre}}',
        listButton: 'Ver menú',
        invalidText: 'Elige una opción',
        options: [
          { id: 'sales', title: 'Ventas' },
          { id: 'help', title: 'Soporte' },
          { title: 'Opción 3' },
          { title: 'Opción 4' },
        ],
      },
    })
    expect(menu.data).not.toHaveProperty('title')
    expect(menu.data).not.toHaveProperty('buttons')
    expect(patched[0]!.graph!.edges.map((edge) => edge.sourceHandle)).toEqual(['next', 'sales'])
  })

  it('opens cards by the words of the customer, any message, or sends and moves on', async () => {
    server.use(http.get(api(`${BOTS}/b1`), () => HttpResponse.json(chatbot(textMenuGraph()))))
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    // «Mensaje de usuario» on the card: the words that open it.
    expect(await screen.findByText('1, ventas')).toBeInTheDocument()
    expect(screen.getByText(es.chatbots.node.waiting)).toBeInTheDocument()
    const edit = async (title: string) => {
      await user.click(
        screen.getByRole('button', {
          name: `${es.chatbots.editor.editNode}: ${title}`,
          hidden: true,
        }),
      )
      return screen.findByLabelText(es.chatbots.editor.editNode)
    }

    // Nothing connects to «Precios»: its words open it from anywhere.
    let editor = await edit('Precios')
    await user.type(within(editor).getByLabelText(es.chatbots.node.trigger), 'precios, precio')
    expect(within(editor).getByRole('checkbox', { name: es.chatbots.node.jump })).toBeChecked()
    await apply(user, editor)

    // «Soporte» takes whatever else the customer writes.
    editor = await edit('Soporte')
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.acceptAny }))
    expect(within(editor).getByText(es.chatbots.node.acceptsAny)).toBeInTheDocument()
    await apply(user, editor)

    // The greeting stops waiting: it keeps one connection, and the card
    // after it no longer needs words.
    editor = await edit('Saludo')
    expect(within(editor).getByLabelText(es.chatbots.node.trigger)).toBeDisabled()
    expect(within(editor).getByText(es.chatbots.node.triggerLocked)).toBeInTheDocument()
    const jump = within(editor).getByRole('checkbox', { name: es.chatbots.node.jump })
    expect(jump).not.toBeChecked()
    expect(within(editor).getByText(es.chatbots.node.waitHelp)).toBeInTheDocument()
    await user.click(jump)
    expect(within(editor).getByText(es.chatbots.node.jumpHelp)).toBeInTheDocument()
    await apply(user, editor)

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const saved = patched[0]!.graph!
    const byId = (id: string) => saved.nodes.find((node) => node.id === id)!
    expect(byId('hello').data).toMatchObject({ wait: false })
    expect(saved.edges.map((edge) => edge.target)).toEqual(['hello', 'sales'])
    expect(byId('sales').trigger).toBe('')
    expect(byId('help').trigger).toBe('*')
    expect(byId('prices').trigger).toBe('precios, precio')
    expect(byId('prices').data).not.toHaveProperty('trigger')
  })

  it('asks before closing a card with changes not applied', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: `${es.chatbots.editor.editNode}: Pasar a Ana`,
        hidden: true,
      }),
    )
    const editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    await user.clear(within(editor).getByLabelText(es.chatbots.node.title))
    await user.type(within(editor).getByLabelText(es.chatbots.node.title), 'Ventas')
    // The ✕ of the header and «Cerrar» of the footer do the same.
    await user.click(
      within(editor).getAllByRole('button', { name: es.chatbots.editor.close }).at(-1)!,
    )
    const confirm = await screen.findByRole('dialog', { name: es.chatbots.editor.discardTitle })
    await user.click(within(confirm).getByRole('button', { name: es.chatbots.editor.discard }))
    await waitFor(() =>
      expect(screen.queryByLabelText(es.chatbots.editor.editNode)).not.toBeInTheDocument(),
    )
    // Nothing reached the canvas.
    expect(screen.getByText('Pasar a Ana')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: es.chatbots.editor.save })).toBeDisabled()

    // Opening another card with changes not applied asks too.
    await user.click(
      screen.getByRole('button', {
        name: `${es.chatbots.editor.editNode}: Pasar a Ana`,
        hidden: true,
      }),
    )
    const again = await screen.findByLabelText(es.chatbots.editor.editNode)
    await user.type(within(again).getByLabelText(es.chatbots.node.title), '!')
    expect(screen.getByText(es.chatbots.editor.notApplied)).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: `${es.chatbots.editor.editNode}: ${es.chatbots.nodes.message.label}`,
        hidden: true,
      }),
    )
    expect(
      await screen.findByRole('dialog', { name: es.chatbots.editor.discardTitle }),
    ).toBeInTheDocument()
  })

  it('builds a condition in «Nueva condición», with «Cumple» and «No cumple»', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    const editor = await addNode(user, es.chatbots.nodes.condition.label)
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.addRule }))
    const dialog = await screen.findByRole('dialog', { name: es.chatbots.node.newRule })
    await user.click(within(dialog).getByRole('combobox', { name: es.chatbots.node.ruleVariable }))
    await user.click(await screen.findByRole('option', { name: es.chatbots.node.lastMessage }))
    await user.click(within(dialog).getByRole('combobox', { name: es.chatbots.node.operator }))
    await user.click(
      await screen.findByRole('option', { name: es.chatbots.node.operators.not_contains }),
    )
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.chatbots.node.value}`)),
      'precio',
    )
    await user.click(within(dialog).getByRole('button', { name: es.chatbots.editor.update }))
    expect(
      within(editor).getByText(`${es.chatbots.node.lastMessage} no contiene «precio»`),
    ).toBeInTheDocument()
    await user.click(within(editor).getByLabelText(es.chatbots.node.matches.any))
    await apply(user, editor)
    expect(await screen.findByText(es.chatbots.node.yes)).toBeInTheDocument()
    expect(screen.getByText(es.chatbots.node.no)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]!.graph!.nodes.at(-1)).toMatchObject({
      type: 'condition',
      data: {
        match: 'any',
        rules: [{ source: 'message', variable: '', operator: 'not_contains', value: 'precio' }],
      },
    })
  })

  it('tries a «Consulta API» with test values before saving it', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    const editor = await addNode(user, es.chatbots.nodes.api.label)
    const url = within(editor).getByRole('textbox', { name: es.chatbots.node.apiUrl })
    await user.clear(url)
    await user.type(url, 'https://api.example.com/saldo/{{{{cedula}}')
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.apiResponses }))
    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.apiAdd }))
    await user.type(within(editor).getByLabelText(es.chatbots.node.apiPath), 'data.saldo')
    await user.type(within(editor).getByLabelText(es.chatbots.node.variable), 'saldo')

    await user.click(within(editor).getByRole('button', { name: es.chatbots.node.apiTest }))
    const dialog = await screen.findByRole('dialog', { name: es.chatbots.node.apiTest })
    await user.type(within(dialog).getByLabelText('{{cedula}}'), '123')
    await user.click(within(dialog).getByRole('button', { name: es.chatbots.node.apiTestRun }))
    expect(await within(dialog).findByText(es.chatbots.node.apiTestStatus(200))).toBeInTheDocument()
    expect(within(dialog).getByText(/\{\{saldo\}\} = 50/)).toBeInTheDocument()
    expect(tested).toEqual([
      {
        api: expect.objectContaining({
          method: 'GET',
          url: 'https://api.example.com/saldo/{{cedula}}',
          responses: [{ path: 'data.saldo', variable: 'saldo' }],
        }) as unknown,
        sample: { cedula: '123' },
      },
    ])
    await user.click(within(dialog).getByRole('button', { name: es.chatbots.editor.close }))
    await apply(user, editor)
    expect(await screen.findByText(es.chatbots.node.ok)).toBeInTheDocument()
    expect(screen.getByText(es.chatbots.node.error)).toBeInTheDocument()
  })

  it('updates a custom field of the contact, sends a location and turns the bot off', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    let editor = await addNode(user, es.chatbots.nodes.contact_field.label)
    await user.click(within(editor).getByRole('combobox', { name: es.chatbots.node.field }))
    await user.click(await screen.findByRole('option', { name: 'Plan' }))
    await user.click(within(editor).getByLabelText(es.chatbots.node.fieldSources.manual))
    await user.type(
      within(editor).getByLabelText(new RegExp(`^${es.chatbots.node.fieldValue}`)),
      'Oro',
    )
    await apply(user, editor)
    expect(await screen.findByText(es.chatbots.node.fieldOk)).toBeInTheDocument()

    editor = await addNode(user, es.chatbots.nodes.location.label)
    await user.type(within(editor).getByLabelText(new RegExp(es.chatbots.node.latitude)), '-16.5')
    await user.type(within(editor).getByLabelText(new RegExp(es.chatbots.node.longitude)), '-68.15')
    await user.type(within(editor).getByLabelText(es.chatbots.node.placeName), 'Oficina')
    expect(within(editor).getByRole('link', { name: es.chatbots.node.seeMap })).toHaveAttribute(
      'href',
      'https://www.google.com/maps?q=-16.5,-68.15',
    )
    await apply(user, editor)

    editor = await addNode(user, es.chatbots.nodes.status.label)
    await user.click(within(editor).getByLabelText(es.chatbots.node.botStates.pause))
    await apply(user, editor)

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const nodes = patched[0]!.graph!.nodes.slice(-3)
    expect(nodes).toMatchObject([
      { type: 'contact_field', data: { field: 'plan', source: 'manual', value: 'Oro' } },
      {
        type: 'location',
        data: { latitude: -16.5, longitude: -68.15, name: 'Oficina', address: '' },
      },
      { type: 'status', data: { status: 'CLOSED', bot: 'pause' } },
    ])
  })

  it('creates a numeric variable in «Variables»', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: es.chatbots.editor.variables }))
    const dialog = await screen.findByRole('dialog', { name: es.chatbots.variables.title })
    expect(within(dialog).getByText(es.chatbots.variables.empty)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: es.chatbots.variables.add }))
    await user.type(within(dialog).getByLabelText(es.chatbots.variables.name), 'cuotas pagadas')
    await user.click(within(dialog).getByLabelText(es.chatbots.variables.type))
    await user.click(
      await screen.findByRole('option', { name: es.chatbots.variables.types.number }),
    )
    await user.type(within(dialog).getByLabelText(es.chatbots.variables.defaultValue), '3')
    await user.click(within(dialog).getByRole('button', { name: es.chatbots.variables.save }))

    await waitFor(() =>
      expect(patched).toEqual([
        {
          variables: [
            { name: 'cuotas_pagadas', type: 'number', defaultValue: '3', description: '' },
          ],
        },
      ]),
    )
    expect(await within(dialog).findByText('{{cuotas_pagadas}}')).toBeInTheDocument()
  })

  it('saves the general settings and warns when no hours are chosen', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: es.chatbots.editor.settings }))
    const dialog = await screen.findByRole('dialog', { name: es.chatbots.settings.title })
    const t = es.chatbots.settings

    await user.type(within(dialog).getByLabelText(t.description), 'Atiende ventas')
    const keywords = within(dialog).getByLabelText(t.keywords)
    await user.type(keywords, 'inicio{Enter}')
    const restart = within(dialog).getByLabelText(t.restart)
    await user.clear(restart)
    await user.type(restart, '1')
    expect(within(dialog).getByRole('button', { name: t.save })).toBeDisabled()
    await user.clear(restart)
    await user.type(restart, '45')

    await user.click(within(dialog).getByLabelText(t.inactivity))
    const wait = within(dialog).getByLabelText(t.inactivityMinutes)
    await user.clear(wait)
    await user.type(wait, '30')
    expect(within(dialog).getByRole('button', { name: t.save })).toBeDisabled()
    await user.clear(wait)
    await user.type(wait, '10')

    await user.click(within(dialog).getByLabelText(t.custom))
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'])
      await user.click(within(dialog).getByLabelText(day))
    expect(within(dialog).getByText(t.noRanges)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: t.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({
      name: 'Bot de ventas',
      description: 'Atiende ventas',
      restartKeywords: ['menu', 'inicio'],
      restartAfterMinutes: 45,
      inactivityMinutes: 10,
      inactivityText: t.inactivityTextDefault,
      schedule: { timezone: 'America/La_Paz', days: [] },
    })
    expect(patched[0]).not.toHaveProperty('graph')
  })
})
