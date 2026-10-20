import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { es } from '../i18n/es'

export function NotFoundPage() {
  useDocumentTitle(es.notFound.title)
  return (
    <Box
      sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', textAlign: 'center', p: 3 }}
    >
      <Box>
        <Typography variant="h2" sx={{ fontWeight: 800, color: 'primary.main' }}>
          404
        </Typography>
        <Typography sx={{ mb: 3 }}>{es.notFound.title}</Typography>
        <Button component={RouterLink} to="/" variant="contained">
          {es.notFound.goHome}
        </Button>
      </Box>
    </Box>
  )
}
