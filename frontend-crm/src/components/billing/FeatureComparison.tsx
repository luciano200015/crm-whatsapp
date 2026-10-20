import CheckOutlined from '@mui/icons-material/CheckOutlined'
import RemoveOutlined from '@mui/icons-material/RemoveOutlined'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { Fragment } from 'react'
import { es } from '../../i18n/es'
import type { CatalogFeature, Plan } from '../../lib/api/types'
import { featureLabel, planFeatureValue } from '../../lib/billing'

const GROUPS = [
  { key: 'limits', label: es.billing.limitsGroup },
  { key: 'features', label: es.billing.featuresGroup },
] as const

/** Every feature of the catalog against every plan. */
export function FeatureComparison({
  plans,
  features,
}: {
  plans: Plan[]
  features: CatalogFeature[]
}) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
      <Table size="small" aria-label={es.billing.compareTitle}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>{es.billing.feature}</TableCell>
            {plans.map((plan) => (
              <TableCell
                key={plan.code}
                align="center"
                sx={{ fontWeight: 800, color: plan.highlighted ? 'primary.main' : undefined }}
              >
                {plan.name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {GROUPS.map((group) => (
            <Fragment key={group.key}>
              <TableRow>
                <TableCell colSpan={plans.length + 1} sx={{ bgcolor: 'action.hover' }}>
                  <Typography variant="overline" sx={{ fontWeight: 700 }}>
                    {group.label}
                  </Typography>
                </TableCell>
              </TableRow>
              {features
                .filter((feature) => feature.group === group.key)
                .map((feature) => (
                  <TableRow key={feature.key} hover>
                    <TableCell>{feature.name}</TableCell>
                    {plans.map((plan) => {
                      const label = featureLabel(feature, planFeatureValue(plan, feature.key))
                      return (
                        <TableCell key={plan.code} align="center">
                          {label === true ? (
                            <CheckOutlined fontSize="small" color="success" aria-label="Incluido" />
                          ) : label === false ? (
                            <RemoveOutlined
                              fontSize="small"
                              sx={{ color: 'text.disabled' }}
                              aria-label="No incluido"
                            />
                          ) : (
                            label
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
