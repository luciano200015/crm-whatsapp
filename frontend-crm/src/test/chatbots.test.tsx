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
} from '../lib/api/chatbots'
import { API_BASE_URL } from '../lib/api/client'
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
      permissions: ['chatbots.manage', 'members.read', 'contacts.read', 'channels.read'],
      plan: null,
    },
  ],
}

/** Inicio → menu (Ventas / Soporte); Ventas → transfer. */
const menuGraph = (): FlowGraph => ({
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
})

/** Inicio → greeting that waits → "1" opens Ventas; "precios" opens Precios from anywhere. */
const textMenuGraph = (): FlowGraph => ({
  nodes: [
    { id: 'start', type: 'start', title: '', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'hello',
      type: 'message',
      title: 'Saludo',
      position: { x: 0, y: 150 },
      data: { text: 'Escribe 1 para ventas', attachments: [], wait: true },
    },
    {
      id: 'sales',
      type: 'message',
      title: 'Ventas',
      trigger: '1, ventas',
      position: { x: 0, y: 300 },
      data: { text: 'Te paso con ventas', attachments: [] },
    },
    {
      id: 'help',
      type: 'message',
      title: 'Soporte',
      trigger: '2',
      position: { x: 300, y: 300 },
      data: { text: 'Cuéntanos', attachments: [] },
    },
    {
      id: 'prices',
      type: 'message',
      title: 'Precios',
      position: { x: 600, y: 300 },
      data: { text: 'Desde 10 USD', attachments: [] },
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

let bots: ChatbotSummary[]
let patched: ChatbotChanges[]
let created: string[]
let simulated: { text: string | null; replyId: string | null }[]

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

  it('tells the customer who got the chat after a transfer', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`^${es.chatbots.nodes.transfer.label}`),
        hidden: true,
      }),
    )
    const editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    const message = within(editor).getByLabelText(es.chatbots.node.transferMessage)
    expect(message).toHaveValue(es.chatbots.node.transferMessageDefault)
    await user.clear(message)
    await user.type(message, 'Ya te atiende {{{{agente}}')

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const added = patched[0]!.graph!.nodes.at(-1)!
    expect(added).toMatchObject({
      type: 'transfer',
      data: { to: 'auto', membershipId: null, message: 'Ya te atiende {{agente}}' },
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

  it('names a card, explains it and asks for the answer when no option fits', async () => {
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    // A titled card shows its title; the rest their kind.
    expect(await screen.findByText('Pasar a Ana')).toBeInTheDocument()
    expect(screen.queryByText('Otra respuesta')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: `${es.chatbots.editor.editNode}: ${es.chatbots.nodes.buttons.label}`,
        hidden: true,
      }),
    )
    const editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    expect(within(editor).getByText(es.chatbots.nodes.buttons.guide)).toBeInTheDocument()
    await user.type(within(editor).getByLabelText(es.chatbots.node.title), 'Menú principal')

    // "Respuesta si elige otra cosa" is required on buttons.
    const invalid = within(editor).getByRole('textbox', { name: es.chatbots.node.invalidText })
    await user.clear(invalid)
    expect(within(editor).getByText(es.chatbots.node.invalidRequired)).toBeInTheDocument()
    await user.type(invalid, 'Elige Ventas o Soporte')

    // "Agregar variable" puts {{nombre}} in the bot's reply.
    const reply = within(editor).getByRole('textbox', { name: es.chatbots.node.botReply })
    await user.clear(reply)
    await user.type(reply, 'Hola ')
    const insert = within(editor).getAllByRole('button', { name: es.chatbots.variables.insert })
    await user.click(insert[0]!)
    await user.click(await screen.findByRole('menuitem', { name: /^Nombre\s*\{\{nombre\}\}/ }))
    expect(reply).toHaveValue('Hola {{nombre}}')

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const menu = patched[0]!.graph!.nodes.find((node) => node.id === 'menu')!
    expect(menu).toMatchObject({
      title: 'Menú principal',
      data: { body: 'Hola {{nombre}}', invalidText: 'Elige Ventas o Soporte' },
    })
    expect(menu.data).not.toHaveProperty('title')
    expect(patched[0]!.graph!.edges.map((edge) => edge.sourceHandle)).toEqual(['next', 'sales'])
  })

  it('opens cards by the words of the customer, or sends and moves on', async () => {
    server.use(http.get(api(`${BOTS}/b1`), () => HttpResponse.json(chatbot(textMenuGraph()))))
    renderAt('/automation/chatbots/b1')
    const user = userEvent.setup()
    expect(await screen.findByText(es.chatbots.node.triggerShort('1, ventas'))).toBeInTheDocument()
    expect(screen.getByText(es.chatbots.node.waiting)).toBeInTheDocument()
    const edit = (title: string) =>
      user.click(
        screen.getByRole('button', {
          name: `${es.chatbots.editor.editNode}: ${title}`,
          hidden: true,
        }),
      )

    // Nothing connects to «Precios»: its words open it from anywhere.
    await edit('Precios')
    let editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    await user.type(within(editor).getByLabelText(es.chatbots.node.trigger), 'precios, precio')
    expect(within(editor).getByRole('checkbox', { name: es.chatbots.node.jump })).toBeChecked()

    // The greeting stops waiting: it keeps one connection, and the card
    // after it no longer needs words.
    await edit('Saludo')
    editor = await screen.findByLabelText(es.chatbots.editor.editNode)
    expect(within(editor).getByLabelText(es.chatbots.node.trigger)).toBeDisabled()
    expect(within(editor).getByText(es.chatbots.node.triggerLocked)).toBeInTheDocument()
    const jump = within(editor).getByRole('checkbox', { name: es.chatbots.node.jump })
    expect(jump).not.toBeChecked()
    expect(within(editor).getByText(es.chatbots.node.waitHelp)).toBeInTheDocument()
    await user.click(jump)
    expect(within(editor).getByText(es.chatbots.node.jumpHelp)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: es.chatbots.editor.save }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const saved = patched[0]!.graph!
    const byId = (id: string) => saved.nodes.find((node) => node.id === id)!
    expect(byId('hello').data).toMatchObject({ wait: false })
    expect(saved.edges.map((edge) => edge.target)).toEqual(['hello', 'sales'])
    expect(byId('sales').trigger).toBe('')
    expect(byId('prices').trigger).toBe('precios, precio')
    expect(byId('prices').data).not.toHaveProperty('trigger')
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
