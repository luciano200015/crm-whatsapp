import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { es } from '../i18n/es'
import { Logo } from './Logo'

/** Full-screen loader shown while the session is being restored. */
export function SplashScreen() {
  return (
    <Box
      role="status"
      aria-label={es.common.loading}
      sx={{
        minHeight: '100svh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ display: 'grid', gap: 3, justifyItems: 'center' }}>
        <Logo />
        <CircularProgress size={28} />
      </Box>
    </Box>
  )
}
