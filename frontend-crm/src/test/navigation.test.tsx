import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { Can } from '../auth/permissions'
import { es } from '../i18n/es'
import { API_BASE_URL } from '../lib/api/client'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'
import { ActiveWorkspaceContext } from '../workspace/active-workspace-context'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href

function makeMe(permissions: string[]): Me {
  return {
    id: 'u1',
    email: 'user@example.com',
    displayName: 'Uma User',
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
        roles: [{ id: 'r1', key: 'custom', name: 'Custom', system: false }],
        permissions,
        plan: null,
      },
    ],
  }
}

let me: Me

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
  http.get(api('/workspaces/w1/members'), () =>
    HttpResponse.json({ items: [], total: 0, usage: { activeMembers: 1, limit: 3 } }),
  ),
  http.get(api('/workspaces/w1/roles'), () => HttpResponse.json([])),
  http.get(api('/workspaces/w1/permissions'), () => HttpResponse.json([])),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
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

const menu = async () => within(await screen.findByRole('navigation', { name: 'menu' }))

describe('Side menu', () => {
  it('groups Agents and Roles under Team when both are allowed', async () => {
    me = makeMe(['workspace.read', 'members.read', 'roles.read', 'billing.read'])
    renderAt('/team/agents')

    const nav = await menu()
    expect(nav.getByRole('button', { name: es.app.nav.team })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(nav.getByRole('link', { name: es.app.nav.agents })).toHaveAttribute(
      'href',
      '/team/agents',
    )
    expect(nav.getByRole('link', { name: es.app.nav.roles })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: es.app.nav.billing })).toBeInTheDocument()
  })

  it('only shows the links the user has permissions for', async () => {
    me = makeMe(['workspace.read', 'members.read'])
    renderAt('/')

    const nav = await menu()
    await userEvent.setup().click(nav.getByRole('button', { name: es.app.nav.team }))
    expect(await nav.findByRole('link', { name: es.app.nav.agents })).toBeInTheDocument()
    expect(nav.queryByRole('link', { name: es.app.nav.roles })).not.toBeInTheDocument()
    expect(nav.queryByRole('link', { name: es.app.nav.billing })).not.toBeInTheDocument()
  })

  it('hides a group when none of its links is allowed', async () => {
    me = makeMe(['workspace.read'])
    renderAt('/')

    const nav = await menu()
    expect(nav.queryByRole('button', { name: es.app.nav.team })).not.toBeInTheDocument()
    expect(nav.getByRole('link', { name: es.app.nav.home })).toBeInTheDocument()
  })
})

describe('Protected pages', () => {
  it('sends users without the permission to the not-authorized page', async () => {
    me = makeMe(['workspace.read', 'members.read'])
    const router = renderAt('/team/roles')

    expect(await screen.findByRole('heading', { name: es.forbidden.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/forbidden')
  })

  it('opens the first Team page the user may see', async () => {
    me = makeMe(['workspace.read', 'roles.read'])
    const router = renderAt('/team')

    expect(
      await screen.findByRole('heading', { name: es.team.rolesTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/team/roles')
  })
})

describe('<Can>', () => {
  const withPermissions = (permissions: string[], ui: React.ReactNode) => {
    const workspace = makeMe(permissions).workspaces[0] ?? null
    return render(
      <ActiveWorkspaceContext value={{ workspaces: [], active: workspace, select: () => {} }}>
        {ui}
      </ActiveWorkspaceContext>,
    )
  }

  it('renders its children only with the permission', () => {
    withPermissions(
      ['contacts.read'],
      <>
        <Can anyOf={['contacts.read']}>
          <span>visible</span>
        </Can>
        <Can anyOf={['contacts.write']}>
          <span>hidden</span>
        </Can>
        <Can allOf={['contacts.read', 'contacts.write']} fallback={<span>fallback</span>}>
          <span>both</span>
        </Can>
      </>,
    )
    expect(screen.getByText('visible')).toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByText('fallback')).toBeInTheDocument()
  })
})
