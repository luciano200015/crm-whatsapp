import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { FeatureComparison } from '../components/billing/FeatureComparison'
import { IntervalToggle } from '../components/billing/IntervalToggle'
import { PlanCard, PopularBadge } from '../components/billing/PlanCard'
import { useCatalog } from '../components/billing/useCatalog'
import { Logo } from '../components/Logo'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { es } from '../i18n/es'
import { errorMessage } from '../lib/api/errors'
import type { BillingInterval } from '../lib/api/types'
import { ColorModeToggle } from '../theme/ColorModeToggle'

/** Public pricing page. Visitors start a trial; signed-in users go to billing. */
export function PricingPage() {
  useDocumentTitle(es.billing.pricingTitle)
  const { status } = useAuth()
  const catalog = useCatalog()
  const [interval, setInterval] = useState<BillingInterval>('MONTH')
  const signedIn = status === 'authenticated'

  const maxSavings = Math.max(0, ...(catalog.data?.plans.map((p) => p.yearlySavingsPercent) ?? []))
  const target = (code: string) =>
    `${signedIn ? '/billing' : '/sign-up'}?plan=${encodeURIComponent(code)}&interval=${interval}`

  return (
    <Box
      sx={(theme) => ({
        minHeight: '100svh',
        background: theme.custom.authBackground.light,
        ...theme.applyStyles('dark', { background: theme.custom.authBackground.dark }),
      })}
    >
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 6 }}
        >
          <RouterLink to={signedIn ? '/' : '/login'} aria-label="Inicio">
            <Logo height={36} />
          </RouterLink>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ColorModeToggle />
            {signedIn ? (
              <Button component={RouterLink} to="/" variant="outlined">
                {es.billing.backToApp}
              </Button>
            ) : (
              <Button component={RouterLink} to="/login" variant="outlined">
                {es.login.submit}
              </Button>
            )}
          </Stack>
        </Stack>

        <Stack spacing={2} sx={{ textAlign: 'center', alignItems: 'center', mb: 5 }}>
          <Typography component="h1" variant="h3" sx={{ fontWeight: 800 }}>
            {es.billing.pricingTitle}
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 620 }}>
            {es.billing.pricingSubtitle}
          </Typography>
          <IntervalToggle value={interval} onChange={setInterval} savingsPercent={maxSavings} />
        </Stack>

        {catalog.isError && <Alert severity="error">{errorMessage(catalog.error)}</Alert>}

        <Grid container spacing={3} sx={{ mb: 8, alignItems: 'stretch' }}>
          {catalog.isPending
            ? [0, 1, 2].map((i) => (
                <Grid key={i} size={{ xs: 12, md: 4 }}>
                  <Skeleton variant="rounded" height={560} />
                </Grid>
              ))
            : catalog.data?.plans.map((plan) => (
                <Grid key={plan.code} size={{ xs: 12, md: 4 }}>
                  <PlanCard
                    plan={plan}
                    features={catalog.data.features}
                    interval={interval}
                    badge={plan.highlighted ? <PopularBadge /> : undefined}
                    action={{
                      label: signedIn
                        ? es.billing.choose
                        : es.billing.startTrial(catalog.data.trialDays),
                      to: target(plan.code),
                    }}
                  />
                </Grid>
              ))}
        </Grid>

        {catalog.data && (
          <Box sx={{ mb: 8 }}>
            <Typography
              component="h2"
              variant="h5"
              sx={{ fontWeight: 800, mb: 2, textAlign: 'center' }}
            >
              {es.billing.compareTitle}
            </Typography>
            <FeatureComparison plans={catalog.data.plans} features={catalog.data.features} />
          </Box>
        )}

        {!signedIn && (
          <Typography sx={{ textAlign: 'center', pb: 4 }}>
            <Button component={RouterLink} to="/login">
              {es.billing.loginCta}
            </Button>
          </Typography>
        )}
      </Container>
    </Box>
  )
}
