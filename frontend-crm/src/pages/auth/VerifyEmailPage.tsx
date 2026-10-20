import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/auth-context'
import { GradientButton } from '../../components/GradientButton'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useTokenFromUrl } from '../../hooks/useTokenFromUrl'
import { es } from '../../i18n/es'
import { authApi } from '../../lib/api/auth'
import { meQueryKey } from '../../lib/api/users'
import { AuthHeader } from '../../layouts/AuthLayout'

type State = 'verifying' | 'done' | 'failed'

// Tokens are single-use: never send the same one twice (StrictMode runs
// effects twice in development).
const attempts = new Map<string, Promise<void>>()

/** Works signed in or not: the link may be opened on another device. */
export function VerifyEmailPage() {
  useDocumentTitle(es.verify.title)
  const token = useTokenFromUrl()
  const { status } = useAuth()
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>(token ? 'verifying' : 'failed')

  useEffect(() => {
    if (!token) return
    let attempt = attempts.get(token)
    if (!attempt) {
      attempt = authApi.verifyEmail(token)
      attempts.set(token, attempt)
    }
    let active = true
    attempt.then(
      () => {
        if (!active) return
        setState('done')
        void queryClient.invalidateQueries({ queryKey: meQueryKey })
      },
      () => active && setState('failed'),
    )
    return () => {
      active = false
    }
  }, [token, queryClient])

  return (
    <>
      <AuthHeader title={es.verify.title} />
      <Stack spacing={3} sx={{ alignItems: 'stretch' }}>
        {state === 'verifying' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <CircularProgress size={28} />
            <Typography sx={{ color: 'text.secondary' }}>{es.verify.verifying}</Typography>
          </Stack>
        )}
        {state === 'done' && <Alert severity="success">{es.verify.done}</Alert>}
        {state === 'failed' && <Alert severity="error">{es.verify.failed}</Alert>}
        {state !== 'verifying' && (
          <GradientButton to={status === 'authenticated' ? '/' : '/login'}>
            {status === 'authenticated' ? es.verify.continue : es.login.submit}
          </GradientButton>
        )}
      </Stack>
    </>
  )
}
