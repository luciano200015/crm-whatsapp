import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import { themeConfig } from '../theme/theme.config'

/** Brand logo(s) from theme.config.ts. */
export function Logo({ height = themeConfig.brand.logoHeight }: { height?: number }) {
  const { brand } = themeConfig
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <Box component="img" src={brand.logo} alt={brand.name} sx={{ height }} />
      {brand.secondaryLogo && (
        <Box component="img" src={brand.secondaryLogo} alt="" aria-hidden sx={{ height }} />
      )}
    </Stack>
  )
}
