import Alert from '@mui/material/Alert'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useLocation } from 'react-router'
import { GradientButton } from '../../components/GradientButton'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { AuthHeader } from '../../layouts/AuthLayout'

const MAILPIT_URL = import.meta.env.VITE_MAILPIT_URL ?? 'http://localhost:8025'

export function SignUpDonePage() {
  useDocumentTitle(es.signUpDone.title)
  const state = useLocation().state as { email?: string } | null
  const email = state?.email ?? 'tu correo'

  return (
    <>
      <AuthHeader title={es.signUpDone.heading} />
      <Stack spacing={3}>
        <Typography sx={{ textAlign: 'center', color: 'text.secondary' }}>
          {es.signUpDone.body(email)}
        </Typography>
        {import.meta.env.DEV && (
          <Alert severity="info">
            {es.signUpDone.devHint}{' '}
            <Link href={MAILPIT_URL} target="_blank" rel="noopener noreferrer">
              {MAILPIT_URL}
            </Link>
          </Alert>
        )}
        <GradientButton to="/login">{es.signUpDone.goToLogin}</GradientButton>
      </Stack>
    </>
  )
}
