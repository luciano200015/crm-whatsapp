import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { es } from '../i18n/es'
import { API_BASE_URL } from '../lib/api/client'
import { createQueryClient } from '../lib/query-client'
import { tokenStore } from '../lib/api/token-store'
import type { Me } from '../lib/api/types'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href

const me: Me = {
  id: 'u1',
  email: 'superadmin@example.com',
  displayName: 'Super Admin',
  status: 'ACTIVE',
  emailVerified: true,
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
      roles: ['OWNER'],
      permissions: ['workspace.read'],
      plan: {
        code: 'team',
        name: 'Equipo',
        status: 'TRIALING',
        hasFullAccess: true,
        trialEndsAt: '2026-10-26T00:00:00.000Z',
        trialDaysLeft: 7,
      },
    },
  ],
}

const tokens = { accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900 }

const server = setupServer(
  http.post(api('/auth/login'), async ({ request }) => {
    const body = (await request.json()) as { password: string }
    return body.password === 'right password here'
      ? HttpResponse.json({ ...tokens, user: { ...me, emailVerified: true } })
      : HttpResponse.json(
          { statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' },
          { status: 401 },
        )
  }),
  http.post(api('/auth/refresh'), () => HttpResponse.json(tokens)),
  http.get(api('/users/me'), ({ request }) =>
    request.headers.get('Authorization') === 'Bearer jwt'
      ? HttpResponse.json(me)
      : HttpResponse.json({ statusCode: 401, message: 'Authentication required' }, { status: 401 }),
  ),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  tokenStore.clear()
  document.cookie = 'crm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})
afterAll(() => server.close())

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

describe('App authentication flow', () => {
  it('sends visitors without a session to the login page', async () => {
    const router = renderApp('/account/security')

    expect(await screen.findByRole('button', { name: es.login.submit })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?redirect=%2Faccount%2Fsecurity')
  })

  it('shows the generic error for wrong credentials', async () => {
    renderApp('/login')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(/Correo electrónico/), 'superadmin@example.com')
    await user.type(screen.getByLabelText(/^Contraseña/), 'wrong password!!')
    await user.click(screen.getByRole('button', { name: es.login.submit }))

    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors.invalidCredentials)
  })

  it('validates the form before calling the API', async () => {
    renderApp('/login')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.login.submit }))

    expect(await screen.findAllByText(es.common.required)).toHaveLength(2)
  })

  it('signs in and lands on the dashboard', async () => {
    const router = renderApp('/login?redirect=%2F')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText(/Correo electrónico/), 'superadmin@example.com')
    await user.type(screen.getByLabelText(/^Contraseña/), 'right password here')
    await user.click(screen.getByRole('button', { name: es.login.submit }))

    expect(await screen.findByText(es.dashboard.hello('Super Admin'))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(tokenStore.get()).toBe('jwt')
  })

  it('restores the session silently from the refresh cookie', async () => {
    document.cookie = 'crm_csrf=abc; path=/'

    renderApp('/')

    expect(await screen.findByText(es.dashboard.hello('Super Admin'))).toBeInTheDocument()
  })

  it('falls back to login when the refresh cookie is no longer valid', async () => {
    document.cookie = 'crm_csrf=abc; path=/'
    server.use(
      http.post(api('/auth/refresh'), () =>
        HttpResponse.json(
          { statusCode: 401, message: 'Invalid or expired session' },
          { status: 401 },
        ),
      ),
    )

    renderApp('/')

    expect(await screen.findByRole('button', { name: es.login.submit })).toBeInTheDocument()
  })
})
