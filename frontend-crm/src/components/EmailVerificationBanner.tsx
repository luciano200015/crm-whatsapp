import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useMe } from '../auth/useMe'
import { es } from '../i18n/es'
import { authApi } from '../lib/api/auth'
import { errorMessage } from '../lib/api/errors'

export function EmailVerificationBanner() {
  const { data: me } = useMe()
  const { enqueueSnackbar } = useSnackbar()
  const resend = useMutation({
    mutationFn: () => authApi.resendVerification(),
    onSuccess: () => enqueueSnackbar(es.verifyBanner.sent, { variant: 'success' }),
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  if (!me || me.emailVerified) return null
  return (
    <Alert
      severity="warning"
      sx={{ mb: 3 }}
      action={
        <Button
          color="inherit"
          size="small"
          disabled={resend.isPending || resend.isSuccess}
          onClick={() => resend.mutate()}
        >
          {es.verifyBanner.resend}
        </Button>
      }
    >
      {es.verifyBanner.text}
    </Alert>
  )
}
