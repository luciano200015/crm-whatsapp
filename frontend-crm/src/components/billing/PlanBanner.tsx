import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { Link as RouterLink } from 'react-router'
import { es } from '../../i18n/es'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

/** Trial countdown or "plan inactive" notice for the active workspace. */
export function PlanBanner() {
  const { active } = useActiveWorkspace()
  const plan = active?.plan
  if (!plan || plan.status === 'ACTIVE') return null

  const message =
    plan.status === 'TRIALING'
      ? es.billing.bannerTrial(plan.trialDaysLeft, plan.name)
      : plan.status === 'EXPIRED'
        ? es.billing.bannerExpired(plan.name)
        : es.billing.bannerInactive(plan.name)

  return (
    <Alert
      severity={
        plan.status === 'TRIALING' ? (plan.trialDaysLeft <= 2 ? 'warning' : 'info') : 'error'
      }
      sx={{ mb: 3 }}
      action={
        <Button component={RouterLink} to="/billing" color="inherit" size="small">
          {es.billing.bannerCta}
        </Button>
      }
    >
      {message}
    </Alert>
  )
}
