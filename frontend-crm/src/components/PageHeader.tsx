import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <Stack spacing={0.5} sx={{ mb: 3 }}>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {subtitle}
        </Typography>
      )}
    </Stack>
  )
}
