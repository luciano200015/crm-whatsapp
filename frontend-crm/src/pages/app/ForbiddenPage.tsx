import BlockOutlined from '@mui/icons-material/BlockOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'

/** Where RequirePermission sends users who open a page they may not see. */
export function ForbiddenPage() {
  useDocumentTitle(es.forbidden.title)
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', textAlign: 'center', py: 10 }}>
      <Box sx={{ maxWidth: 420 }}>
        <BlockOutlined sx={{ fontSize: 56, color: 'error.main', mb: 2 }} />
        <Typography component="h1" variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          {es.forbidden.title}
        </Typography>
        <Typography sx={{ color: 'text.secondary', mb: 3 }}>{es.forbidden.body}</Typography>
        <Button component={RouterLink} to="/" variant="contained">
          {es.forbidden.goHome}
        </Button>
      </Box>
    </Box>
  )
}
