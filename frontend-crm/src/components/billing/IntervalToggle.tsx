import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { es } from '../../i18n/es'
import type { BillingInterval } from '../../lib/api/types'

export function IntervalToggle({
  value,
  onChange,
  savingsPercent,
}: {
  value: BillingInterval
  onChange: (interval: BillingInterval) => void
  savingsPercent: number
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={value}
        onChange={(_event, next: BillingInterval | null) => next && onChange(next)}
        aria-label="Periodo de facturación"
        sx={{ '& .MuiToggleButton-root': { px: 2.5, textTransform: 'none', fontWeight: 600 } }}
      >
        <ToggleButton value="MONTH">{es.billing.monthly}</ToggleButton>
        <ToggleButton value="YEAR">{es.billing.yearly}</ToggleButton>
      </ToggleButtonGroup>
      {savingsPercent > 0 && (
        <Chip
          size="small"
          color="success"
          variant="outlined"
          label={es.billing.yearlyPromo(savingsPercent)}
        />
      )}
    </Stack>
  )
}
