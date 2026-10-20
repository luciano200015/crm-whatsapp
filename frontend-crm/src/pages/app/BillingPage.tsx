import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Grid from '@mui/material/Grid'
import LinearProgress from '@mui/material/LinearProgress'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { IntervalToggle } from '../../components/billing/IntervalToggle'
import { PlanCard, PopularBadge } from '../../components/billing/PlanCard'
import { useCatalog } from '../../components/billing/useCatalog'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PageHeader } from '../../components/PageHeader'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { billingApi, subscriptionQueryKey } from '../../lib/api/billing'
import { ApiError, errorMessage } from '../../lib/api/errors'
import type { BillingInterval, Entitlement, Plan, Subscription } from '../../lib/api/types'
import { meQueryKey } from '../../lib/api/users'
import { formatDate, formatMoney, formatNumber, priceFor, statusTone } from '../../lib/billing'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

type PendingAction =
  | { kind: 'change'; plan: Plan; interval: BillingInterval }
  | { kind: 'activate' | 'cancel' | 'resume' }

export function BillingPage() {
  useDocumentTitle(es.billing.title)
  const { active } = useActiveWorkspace()
  const canRead = active?.permissions.includes('billing.read') ?? false
  const canManage = active?.permissions.includes('billing.manage') ?? false

  const subscription = useQuery({
    queryKey: subscriptionQueryKey(active?.id ?? 'none'),
    queryFn: () => billingApi.subscription(active?.id ?? ''),
    enabled: Boolean(active && canRead),
    retry: false,
  })

  if (!active) return <Alert severity="info">{es.dashboard.noWorkspace}</Alert>

  const noPlan = subscription.error instanceof ApiError && subscription.error.status === 404

  return (
    <>
      <PageHeader title={es.billing.title} subtitle={`${active.name} · ${es.billing.subtitle}`} />
      {!canRead ? (
        <Alert severity="info">
          {es.billing.noPermission}
          {active.plan && ` (${active.plan.name} · ${es.billing.status[active.plan.status]})`}
        </Alert>
      ) : subscription.isPending ? (
        <Skeleton variant="rounded" height={260} />
      ) : subscription.isError && !noPlan ? (
        <Alert severity="error">{errorMessage(subscription.error)}</Alert>
      ) : (
        <Stack spacing={4}>
          {noPlan && <Alert severity="warning">{es.billing.noPlan}</Alert>}
          {subscription.data && (
            <CurrentPlan subscription={subscription.data} canManage={canManage} />
          )}
          <PlanPicker
            workspaceId={active.id}
            subscription={subscription.data}
            canManage={canManage}
          />
        </Stack>
      )}
    </>
  )
}

function useSubscriptionMutation(workspaceId: string) {
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  return useMutation({
    mutationFn: (action: PendingAction) => {
      switch (action.kind) {
        case 'change':
          return billingApi.changePlan(workspaceId, action.plan.code, action.interval)
        case 'activate':
          return billingApi.activate(workspaceId)
        case 'cancel':
          return billingApi.cancel(workspaceId)
        case 'resume':
          return billingApi.resume(workspaceId)
      }
    },
    onSuccess: (updated, action) => {
      queryClient.setQueryData(subscriptionQueryKey(workspaceId), updated)
      // The banner and the dashboard read the plan summary from /users/me.
      void queryClient.invalidateQueries({ queryKey: meQueryKey })
      const message =
        action.kind === 'change'
          ? es.billing.changed(updated.plan.name)
          : action.kind === 'activate'
            ? es.billing.activated
            : action.kind === 'cancel'
              ? es.billing.canceled
              : es.billing.resumed
      enqueueSnackbar(message, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
}

function CurrentPlan({
  subscription,
  canManage,
}: {
  subscription: Subscription
  canManage: boolean
}) {
  const mutation = useSubscriptionMutation(subscription.workspaceId)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const s = subscription

  const limits = s.entitlements.filter((e) => e.kind === 'LIMIT')
  const included = s.entitlements.filter(
    (e) => e.kind !== 'LIMIT' && e.value !== false && e.value !== null,
  )

  const timeline =
    s.status === 'TRIALING'
      ? `${es.billing.trialLeft(s.trialDaysLeft)} · ${es.billing.trialEnds(formatDate(s.trialEndsAt))}`
      : s.status === 'ACTIVE'
        ? s.cancelAtPeriodEnd
          ? es.billing.endsOn(formatDate(s.currentPeriodEnd))
          : es.billing.renews(formatDate(s.currentPeriodEnd))
        : null

  const canActivate = s.status !== 'ACTIVE' && s.paymentsEnabled
  const canCancel = s.status === 'TRIALING' || (s.status === 'ACTIVE' && !s.cancelAtPeriodEnd)
  const canResume = s.status === 'ACTIVE' && s.cancelAtPeriodEnd

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 5 }}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <Box sx={(theme) => ({ height: 4, background: theme.custom.gradient })} />
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {s.plan.name}
              </Typography>
              <Chip size="small" color={statusTone(s.status)} label={es.billing.status[s.status]} />
            </Stack>
            <Typography sx={{ color: 'text.secondary' }}>
              {formatMoney(s.amountCents, s.currency)} {s.currency}{' '}
              {s.interval === 'YEAR' ? es.billing.perYear : es.billing.perMonth}
            </Typography>
            {timeline && (
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                {timeline}
              </Typography>
            )}

            {s.paymentsEnabled ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                {es.billing.simulatedPayments}
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {es.billing.paymentsDisabled}
              </Alert>
            )}

            {canManage ? (
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 3, flexWrap: 'wrap' }}>
                {canActivate && (
                  <Button variant="contained" onClick={() => setPending({ kind: 'activate' })}>
                    {es.billing.activate}
                  </Button>
                )}
                {canResume && (
                  <Button variant="outlined" onClick={() => setPending({ kind: 'resume' })}>
                    {es.billing.resume}
                  </Button>
                )}
                {canCancel && (
                  <Button color="error" onClick={() => setPending({ kind: 'cancel' })}>
                    {es.billing.cancel}
                  </Button>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3 }}>
                {es.billing.readOnly}
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 7 }}>
        <Card variant="outlined" sx={{ height: '100%' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              {es.billing.usage}
            </Typography>
            <Stack spacing={2}>
              {limits.map((limit) => (
                <LimitRow key={limit.key} entitlement={limit} />
              ))}
            </Stack>
            <Typography variant="h6" sx={{ fontWeight: 700, mt: 3, mb: 1.5 }}>
              {es.billing.includedFeatures}
            </Typography>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
              {included.map((feature) => (
                <Chip
                  key={feature.key}
                  size="small"
                  variant="outlined"
                  icon={<CheckCircleOutlined />}
                  label={
                    typeof feature.value === 'string'
                      ? `${feature.name}: ${feature.value}`
                      : feature.name
                  }
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <ConfirmDialog
        open={pending !== null && pending.kind !== 'change'}
        title={
          pending?.kind === 'activate'
            ? es.billing.activate
            : pending?.kind === 'resume'
              ? es.billing.resume
              : es.billing.cancel
        }
        confirmLabel={
          pending?.kind === 'activate'
            ? es.billing.activate
            : pending?.kind === 'resume'
              ? es.billing.resume
              : es.billing.cancel
        }
        danger={pending?.kind === 'cancel'}
        loading={mutation.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return
          mutation.mutate(pending, { onSettled: () => setPending(null) })
        }}
      >
        {pending?.kind === 'cancel'
          ? s.status === 'TRIALING'
            ? es.billing.confirmCancelTrial
            : es.billing.confirmCancelPaid
          : `${s.plan.name} · ${formatMoney(s.amountCents, s.currency)} ${s.currency}`}
      </ConfirmDialog>
    </Grid>
  )
}

function LimitRow({ entitlement }: { entitlement: Entitlement }) {
  const limit = entitlement.value
  const unit = entitlement.unit ? ` ${entitlement.unit}` : ''
  const text =
    limit === null
      ? es.billing.unlimited
      : typeof limit === 'number'
        ? entitlement.usage !== null
          ? `${formatNumber(entitlement.usage)} ${es.billing.of} ${formatNumber(limit)}${unit}`
          : `${formatNumber(limit)}${unit}`
        : '—'
  const percent =
    typeof limit === 'number' && limit > 0 && entitlement.usage !== null
      ? Math.min(100, (entitlement.usage / limit) * 100)
      : null

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2">{entitlement.name}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {limit === 0 ? '—' : text}
        </Typography>
      </Stack>
      {percent !== null && (
        <LinearProgress
          variant="determinate"
          value={percent}
          color={percent >= 100 ? 'error' : percent >= 80 ? 'warning' : 'primary'}
          sx={{ height: 6, borderRadius: 3 }}
          aria-label={entitlement.name}
        />
      )}
    </Box>
  )
}

function PlanPicker({
  workspaceId,
  subscription,
  canManage,
}: {
  workspaceId: string
  subscription: Subscription | undefined
  canManage: boolean
}) {
  const catalog = useCatalog()
  const [params] = useSearchParams()
  const requested = params.get('interval')
  const [interval, setInterval] = useState<BillingInterval>(
    requested === 'YEAR' || requested === 'MONTH' ? requested : (subscription?.interval ?? 'MONTH'),
  )
  const [pending, setPending] = useState<{ plan: Plan; interval: BillingInterval } | null>(null)
  const mutation = useSubscriptionMutation(workspaceId)
  const requestedPlan = params.get('plan')

  if (!catalog.data) return <Skeleton variant="rounded" height={400} />

  const live = subscription?.status === 'TRIALING' || subscription?.status === 'ACTIVE'
  const maxSavings = Math.max(0, ...catalog.data.plans.map((p) => p.yearlySavingsPercent))
  const pendingPrice = pending ? priceFor(pending.plan, pending.interval) : undefined

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, mb: 3 }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {es.billing.changePlan}
        </Typography>
        <IntervalToggle value={interval} onChange={setInterval} savingsPercent={maxSavings} />
      </Stack>
      <Grid container spacing={3}>
        {catalog.data.plans.map((plan) => {
          const current =
            live && subscription.plan.code === plan.code && subscription.interval === interval
          return (
            <Grid key={plan.code} size={{ xs: 12, md: 4 }}>
              <PlanCard
                plan={plan}
                features={catalog.data.features}
                interval={interval}
                current={current}
                badge={
                  plan.code === requestedPlan ? (
                    <Chip color="secondary" size="small" label={es.signUp.selectedPlan} />
                  ) : plan.highlighted ? (
                    <PopularBadge />
                  ) : undefined
                }
                action={{
                  label: es.billing.choose,
                  disabled: !canManage,
                  onClick: () => setPending({ plan, interval }),
                }}
              />
            </Grid>
          )
        })}
      </Grid>

      <ConfirmDialog
        open={pending !== null}
        title={es.billing.pickTitle}
        confirmLabel={es.billing.choose}
        loading={mutation.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return
          mutation.mutate(
            { kind: 'change', plan: pending.plan, interval: pending.interval },
            { onSettled: () => setPending(null) },
          )
        }}
      >
        {pending && pendingPrice && (
          <>
            <strong>{pending.plan.name}</strong> ·{' '}
            {formatMoney(pendingPrice.amountCents, pendingPrice.currency)} {pendingPrice.currency}{' '}
            {pending.interval === 'YEAR' ? es.billing.perYear : es.billing.perMonth}
            {subscription?.status === 'TRIALING' && (
              <Box component="span" sx={{ display: 'block', mt: 1 }}>
                {es.billing.trialLeft(subscription.trialDaysLeft)}
              </Box>
            )}
          </>
        )}
      </ConfirmDialog>
    </Box>
  )
}
