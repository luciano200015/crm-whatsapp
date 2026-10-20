import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import RemoveOutlined from '@mui/icons-material/RemoveOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { es } from '../../i18n/es'
import type { BillingInterval, CatalogFeature, Plan } from '../../lib/api/types'
import { featureLabel, formatMoney, planFeatureValue, priceFor } from '../../lib/billing'
import { GradientButton } from '../GradientButton'

export interface PlanCardProps {
  plan: Plan
  features: CatalogFeature[]
  interval: BillingInterval
  /** Primary action; rendered as the card's main button. */
  action: {
    label: string
    onClick?: () => void
    to?: string
    disabled?: boolean
    loading?: boolean
  }
  badge?: ReactNode
  /** Highlights the card as the workspace's current plan. */
  current?: boolean
}

/** A pricing card: name, price for the chosen interval, key limits and inclusions. */
export function PlanCard({ plan, features, interval, action, badge, current }: PlanCardProps) {
  const price = priceFor(plan, interval)
  const yearly = interval === 'YEAR'
  const emphasized = plan.highlighted || current

  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: 3,
        borderRadius: 4,
        borderWidth: emphasized ? 2 : 1,
        borderColor: emphasized ? 'primary.main' : 'divider',
        overflow: 'visible',
        ...(plan.highlighted && {
          boxShadow: `0 24px 48px -24px ${theme.vars?.palette.primary.main ?? theme.palette.primary.main}`,
        }),
      })}
    >
      {badge && (
        <Box sx={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)' }}>
          {badge}
        </Box>
      )}

      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        {plan.name}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', minHeight: 40 }}>
        {plan.tagline}
      </Typography>

      {price && (
        <Box sx={{ my: 2.5 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
            <Typography component="span" sx={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
              {formatMoney(price.monthlyEquivalentCents, price.currency, true)}
            </Typography>
            <Typography component="span" sx={{ color: 'text.secondary' }}>
              {price.currency} {es.billing.perMonth}
            </Typography>
          </Stack>
          <Typography
            variant="body2"
            sx={{ color: 'success.main', fontWeight: 600, mt: 1, minHeight: 20 }}
          >
            {yearly &&
              `${es.billing.billedYearly(formatMoney(price.amountCents, price.currency))}${
                plan.yearlySavingsPercent > 0
                  ? ` · ${es.billing.savePercent(plan.yearlySavingsPercent)}`
                  : ''
              }`}
          </Typography>
        </Box>
      )}

      {current ? (
        <Button variant="outlined" size="large" fullWidth disabled>
          {es.billing.current}
        </Button>
      ) : (
        <GradientButton
          to={action.to}
          onClick={action.onClick}
          disabled={action.disabled}
          loading={action.loading}
        >
          {action.label}
        </GradientButton>
      )}

      <Divider sx={{ my: 2.5 }} />
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {es.billing.included}
      </Typography>
      <Stack spacing={1.1}>
        {features
          .map((feature) => ({
            feature,
            label: featureLabel(feature, planFeatureValue(plan, feature.key)),
          }))
          // Cards list limits and what is included; the comparison table shows the rest.
          .filter(({ feature, label }) => feature.group === 'limits' || label !== false)
          .map(({ feature, label }) => {
            const included = label !== false
            return (
              <Stack
                key={feature.key}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'flex-start', opacity: included ? 1 : 0.45 }}
              >
                {included ? (
                  <CheckCircleOutlined fontSize="small" color="success" sx={{ mt: '1px' }} />
                ) : (
                  <RemoveOutlined fontSize="small" sx={{ mt: '1px', color: 'text.disabled' }} />
                )}
                <Typography variant="body2">
                  {typeof label === 'string' && feature.kind === 'LIMIT' ? (
                    <>
                      <strong>{label}</strong> · {feature.name}
                    </>
                  ) : typeof label === 'string' ? (
                    `${feature.name}: ${label}`
                  ) : (
                    feature.name
                  )}
                </Typography>
              </Stack>
            )
          })}
      </Stack>
    </Card>
  )
}

export function PopularBadge() {
  return (
    <Chip color="primary" size="small" label={es.billing.mostPopular} sx={{ fontWeight: 700 }} />
  )
}
