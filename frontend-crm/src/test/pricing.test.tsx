import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppProviders } from '../AppProviders'
import { es } from '../i18n/es'
import { API_BASE_URL } from '../lib/api/client'
import type { PlanCatalog } from '../lib/api/types'
import { createQueryClient } from '../lib/query-client'
import { routes } from '../router'

const api = (path: string) => new URL(`${API_BASE_URL}${path}`, window.location.origin).href

const plan = (code: string, name: string, month: number, year: number, agents: number) => ({
  code,
  name,
  tagline: `${name} tagline`,
  description: null,
  highlighted: code === 'business',
  yearlySavingsPercent: 17,
  prices: [
    {
      interval: 'MONTH' as const,
      currency: 'USD',
      amountCents: month,
      monthlyEquivalentCents: month,
    },
    {
      interval: 'YEAR' as const,
      currency: 'USD',
      amountCents: year,
      monthlyEquivalentCents: Math.round(year / 12),
    },
  ],
  features: [
    { key: 'limits.agents', value: agents },
    { key: 'features.sales_funnels', value: code !== 'team' },
  ],
})

const catalog: PlanCatalog = {
  currency: 'USD',
  trialDays: 7,
  defaultPlan: 'team',
  paymentsEnabled: true,
  features: [
    {
      key: 'limits.agents',
      name: 'Agentes',
      description: null,
      kind: 'LIMIT',
      unit: 'agentes',
      group: 'limits',
    },
    {
      key: 'features.sales_funnels',
      name: 'Embudos de venta',
      description: null,
      kind: 'BOOLEAN',
      unit: null,
      group: 'features',
    },
  ],
  plans: [
    plan('team', 'Equipo', 9_900, 99_000, 3),
    plan('business', 'Empresa', 22_900, 229_000, 10),
    plan('corporate', 'Corporativo', 59_900, 599_000, 30),
  ],
}

const server = setupServer(http.get(api('/billing/plans'), () => HttpResponse.json(catalog)))

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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

describe('Pricing page', () => {
  it('shows the three plans with monthly prices and trial CTAs', async () => {
    renderAt('/pricing')

    expect(await screen.findByRole('heading', { name: 'Empresa' })).toBeInTheDocument()
    expect(screen.getByText('$99')).toBeInTheDocument()
    expect(screen.getByText('$229')).toBeInTheDocument()
    expect(screen.getByText(es.billing.mostPopular)).toBeInTheDocument()

    const ctas = screen.getAllByRole('link', { name: es.billing.startTrial(7) })
    expect(ctas.map((a) => a.getAttribute('href'))).toEqual([
      '/sign-up?plan=team&interval=MONTH',
      '/sign-up?plan=business&interval=MONTH',
      '/sign-up?plan=corporate&interval=MONTH',
    ])
  })

  it('switches to yearly prices and links the yearly plan', async () => {
    renderAt('/pricing')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: es.billing.yearly }))

    expect(screen.getByText('$191')).toBeInTheDocument()
    expect(
      screen.getByText(`${es.billing.billedYearly('$2,290')} · ${es.billing.savePercent(17)}`),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: es.billing.startTrial(7) })[1]?.getAttribute('href'),
    ).toBe('/sign-up?plan=business&interval=YEAR')
  })

  it('compares every feature in a table', async () => {
    renderAt('/pricing')

    const table = await screen.findByRole('table', { name: es.billing.compareTitle })
    expect(within(table).getByText('10 agentes')).toBeInTheDocument()
    expect(within(table).getAllByLabelText('Incluido')).toHaveLength(2)
  })
})

describe('Sign-up with a chosen plan', () => {
  it('shows the selected plan and the trial call to action', async () => {
    renderAt('/sign-up?plan=business&interval=YEAR')

    expect(
      await screen.findByText(`${es.signUp.selectedPlan}: Empresa · ${es.billing.yearly}`),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: es.signUp.startTrial(7) })).toBeInTheDocument()
  })
})
