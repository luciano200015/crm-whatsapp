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
import type {
  Line,
  Me,
  Member,
  MemberList,
  PermissionInfo,
  PlanCatalog,
  Role,
} from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href
const WS = '/workspaces/w1'

const ALL_PERMISSIONS = Object.keys(es.roles.permissions)

function makeMe(overrides: Partial<Me> = {}, planCode = 'business'): Me {
  return {
    id: 'u-owner',
    email: 'owner@example.com',
    displayName: 'Olga Owner',
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
        roles: [{ id: 'r-owner', key: 'OWNER', name: 'Owner', system: true }],
        permissions: ALL_PERMISSIONS,
        plan: {
          code: planCode,
          name: planCode === 'team' ? 'Equipo' : 'Empresa',
          status: 'ACTIVE',
          hasFullAccess: true,
          trialEndsAt: null,
          trialDaysLeft: 0,
        },
      },
    ],
    ...overrides,
  }
}

const systemRole = (key: string, permissions: string[]): Role => ({
  id: `r-${key.toLowerCase()}`,
  key,
  name: key,
  description: null,
  system: true,
  permissions,
  memberCount: 1,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
})

const roles: Role[] = [
  systemRole('OWNER', ALL_PERMISSIONS),
  systemRole('AGENT', ['contacts.read', 'messages.read', 'messages.send']),
  {
    ...systemRole('supervisor', ['members.read', 'contacts.read']),
    id: 'r-supervisor',
    name: 'Supervisor',
    description: 'Supervisa al equipo',
    system: false,
  },
]

const permissionCatalog: PermissionInfo[] = ALL_PERMISSIONS.map((key) => ({
  key,
  group: key.split('.')[0] ?? key,
  description: key,
}))

const member = (overrides: Partial<Member>): Member => ({
  id: 'm-owner',
  userId: 'u-owner',
  email: 'owner@example.com',
  displayName: 'Olga Owner',
  avatarUrl: null,
  status: 'ACTIVE',
  pendingFirstAccess: false,
  lastLoginAt: null,
  joinedAt: '2026-10-19T00:00:00.000Z',
  deactivatedAt: null,
  role: { id: 'r-owner', key: 'OWNER', name: 'Owner', system: true },
  permissions: ALL_PERMISSIONS,
  lines: [],
  ...overrides,
})

const catalog: PlanCatalog = {
  currency: 'USD',
  trialDays: 7,
  defaultPlan: 'team',
  paymentsEnabled: true,
  features: [],
  plans: [
    {
      code: 'team',
      name: 'Equipo',
      tagline: null,
      description: null,
      highlighted: false,
      prices: [],
      yearlySavingsPercent: 17,
      features: [{ key: 'features.custom_roles', value: false }],
    },
    {
      code: 'business',
      name: 'Empresa',
      tagline: null,
      description: null,
      highlighted: true,
      prices: [],
      yearlySavingsPercent: 17,
      features: [{ key: 'features.custom_roles', value: true }],
    },
  ],
}

let me: Me
let memberList: MemberList
let posted: unknown[]

const whatsappLines = [
  { id: 'l-ventas', name: 'Ventas', displayPhone: '+591 70000001', status: 'CONNECTED' },
  { id: 'l-soporte', name: 'Soporte', displayPhone: '+591 70000002', status: 'ERROR' },
] as Line[]

const server = setupServer(
  http.post(api('/auth/refresh'), () =>
    HttpResponse.json({ accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900 }),
  ),
  http.get(api('/users/me'), () => HttpResponse.json(me)),
  http.get(api('/billing/plans'), () => HttpResponse.json(catalog)),
  http.get(api(`${WS}/members`), () => HttpResponse.json(memberList)),
  http.get(api(`${WS}/roles`), () => HttpResponse.json(roles)),
  http.get(api(`${WS}/permissions`), () => HttpResponse.json(permissionCatalog)),
  http.post(api(`${WS}/members`), async ({ request }) => {
    const body = (await request.json()) as { email: string; displayName: string }
    posted.push(body)
    return HttpResponse.json(
      member({ id: 'm-new', userId: 'u-new', ...body, pendingFirstAccess: true }),
      { status: 201 },
    )
  }),
  http.get(api(`${WS}/channels/lines`), () => HttpResponse.json(whatsappLines)),
  http.put(api(`${WS}/members/:memberId/lines`), async ({ request, params }) => {
    const body = (await request.json()) as { lineIds: string[] }
    posted.push({ memberId: params.memberId, ...body })
    const updated = memberList.items.find((item) => item.id === params.memberId)
    return HttpResponse.json({
      ...updated,
      lines: whatsappLines.filter((line) => body.lineIds.includes(line.id)),
    })
  }),
  http.post(api(`${WS}/roles`), async ({ request }) => {
    posted.push(await request.json())
    return HttpResponse.json(roles[2], { status: 201 })
  }),
  http.post(api('/auth/password/change'), async ({ request }) => {
    posted.push(await request.json())
    me = { ...me, mustChangePassword: false }
    return new HttpResponse(null, { status: 204 })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  me = makeMe()
  memberList = {
    items: [
      member({}),
      member({
        id: 'm-agent',
        userId: 'u-agent',
        email: 'agent@example.com',
        displayName: 'Andrés Agente',
        role: { id: 'r-agent', key: 'AGENT', name: 'Agent', system: true },
        permissions: ['contacts.read', 'messages.read', 'messages.send'],
        pendingFirstAccess: true,
      }),
    ],
    total: 2,
    usage: { activeMembers: 2, limit: 10 },
  }
  posted = []
  // Signed in: the app restores the session from the refresh cookie.
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

describe('Team: members', () => {
  it('lists agents with their role, status and the plan usage', async () => {
    renderAt('/team/members')
    const user = userEvent.setup()

    const row = (await screen.findByText('Andrés Agente')).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLElement)
    expect(cells.getByText(es.roles.system.AGENT?.name ?? '')).toBeInTheDocument()
    expect(cells.getByText(es.team.status.pending)).toBeInTheDocument()
    expect(screen.getByText(es.team.usage(2, 10))).toBeInTheDocument()
    // On your own row you can only pick your lines.
    await user.click(screen.getByRole('button', { name: es.team.actionsFor('Olga Owner') }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      es.team.assignLines,
    ])
  })

  it('registers a new agent', async () => {
    renderAt('/team/members')
    const user = userEvent.setup()

    const newMember = await screen.findByRole('button', { name: es.team.newMember })
    // Enabled once the assignable roles have loaded.
    await waitFor(() => expect(newMember).toBeEnabled())
    await user.click(newMember)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre completo/), 'Carla Pérez')
    await user.type(within(dialog).getByLabelText(/Correo electrónico/), 'carla@example.com')
    await user.click(within(dialog).getByRole('button', { name: es.team.form.submit }))

    expect(await screen.findByText(es.team.created('carla@example.com'))).toBeInTheDocument()
    expect(posted).toEqual([
      { displayName: 'Carla Pérez', email: 'carla@example.com', roleId: 'r-agent' },
    ])
  })

  it('shows the lines of each agent and assigns them', async () => {
    renderAt('/team/members')
    const user = userEvent.setup()

    const agentRow = (await screen.findByText('Andrés Agente')).closest('tr') as HTMLElement
    expect(within(agentRow).getByText(es.team.noLines)).toBeInTheDocument()
    const ownerRow = screen.getByText('Olga Owner').closest('tr') as HTMLElement
    expect(within(ownerRow).getByText(es.team.allLines)).toBeInTheDocument()

    await user.click(
      within(agentRow).getByRole('button', { name: es.team.actionsFor('Andrés Agente') }),
    )
    await user.click(await screen.findByRole('menuitem', { name: es.team.assignLines }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(es.lines.status.ERROR)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Ventas' }))
    await user.click(within(dialog).getByRole('button', { name: es.team.linesDialog.save }))

    expect(await screen.findByText(es.team.linesSaved)).toBeInTheDocument()
    expect(posted).toEqual([{ memberId: 'm-agent', lineIds: ['l-ventas'] }])
  })

  it('blocks new agents when the plan limit is reached', async () => {
    memberList = { ...memberList, usage: { activeMembers: 3, limit: 3 } }
    me = makeMe({}, 'team')
    renderAt('/team/members')

    expect(await screen.findByText(es.team.limitReached('Equipo'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: es.team.newMember })).toBeDisabled()
  })
})

describe('Team: roles', () => {
  it('shows system roles as read-only and custom roles as editable', async () => {
    renderAt('/team/roles')

    const ownerCard = (await screen.findByText(es.roles.system.OWNER?.name ?? '')).closest(
      '.MuiCard-root',
    ) as HTMLElement
    expect(within(ownerCard).getByText(es.team.systemRole)).toBeInTheDocument()
    expect(within(ownerCard).getByRole('button', { name: es.team.view })).toBeInTheDocument()
    expect(within(ownerCard).queryByRole('button', { name: es.team.edit })).not.toBeInTheDocument()

    const customCard = screen.getByText('Supervisor').closest('.MuiCard-root') as HTMLElement
    expect(within(customCard).getByText(es.team.customRole)).toBeInTheDocument()
    expect(within(customCard).getByRole('button', { name: es.team.edit })).toBeInTheDocument()
    expect(within(customCard).getByRole('button', { name: es.team.delete })).toBeInTheDocument()
  })

  it('creates a custom role from grouped permissions', async () => {
    renderAt('/team/roles')
    const user = userEvent.setup()

    const newRole = await screen.findByRole('button', { name: es.team.newRole })
    // Enabled once the plan catalog and the permission list have loaded.
    await waitFor(() => expect(newRole).toBeEnabled())
    await user.click(newRole)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Nombre del rol/), 'Ventas')
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: `${es.team.roleForm.selectAll}: ${es.roles.groups.contacts}`,
      }),
    )
    await user.click(within(dialog).getByLabelText(es.roles.permissions['messages.send'] ?? ''))
    await user.click(within(dialog).getByRole('button', { name: es.team.roleForm.save }))

    await waitFor(() =>
      expect(posted).toEqual([
        {
          name: 'Ventas',
          description: null,
          permissions: ['contacts.read', 'contacts.write', 'messages.send'],
        },
      ]),
    )
  })

  it('explains that the plan does not include custom roles', async () => {
    me = makeMe({}, 'team')
    renderAt('/team/roles')

    expect(await screen.findByText(es.team.customRolesLocked('Equipo'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: es.team.newRole })).toBeDisabled()
  })
})

describe('Temporary password', () => {
  it('forces the user to choose a password before entering the app', async () => {
    me = makeMe({ mustChangePassword: true })
    const router = renderAt('/team/members')
    const user = userEvent.setup()

    expect(await screen.findByText(es.passwordRequired.heading)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account/password-required')

    await user.type(screen.getByLabelText(/Contraseña temporal/), 'Tmp4k9QmZp2xWv7R')
    await user.type(screen.getByLabelText(/^Nueva contraseña/), 'my own long passphrase')
    await user.type(screen.getByLabelText(/Repite la nueva contraseña/), 'my own long passphrase')
    await user.click(screen.getByRole('button', { name: es.passwordRequired.submit }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(posted).toEqual([
      { currentPassword: 'Tmp4k9QmZp2xWv7R', newPassword: 'my own long passphrase' },
    ])
  })
})
