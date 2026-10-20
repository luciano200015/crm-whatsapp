import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import { GradientButton } from '../../components/GradientButton'
import { PasswordField } from '../../components/form/PasswordField'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useTokenFromUrl } from '../../hooks/useTokenFromUrl'
import { es } from '../../i18n/es'
import { authApi } from '../../lib/api/auth'
import { errorMessage } from '../../lib/api/errors'
import { resetSchema, type ResetValues } from '../../lib/validation'
import { AuthHeader } from '../../layouts/AuthLayout'

export function ResetPasswordPage() {
  useDocumentTitle(es.reset.title)
  const token = useTokenFromUrl()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { control, handleSubmit, formState } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  })

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!token) return
    setError(null)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  if (!token) {
    return (
      <>
        <AuthHeader title={es.reset.heading} />
        <Stack spacing={3}>
          <Alert severity="error">{es.reset.missingToken}</Alert>
          <Button component={RouterLink} to="/forgot-password" variant="outlined">
            {es.reset.requestNew}
          </Button>
        </Stack>
      </>
    )
  }

  return (
    <>
      <AuthHeader title={es.reset.heading} subtitle={!done && es.reset.body} />
      {done ? (
        <Stack spacing={3}>
          <Alert severity="success">{es.reset.done}</Alert>
          <GradientButton to="/login">{es.login.submit}</GradientButton>
        </Stack>
      ) : (
        <Box component="form" noValidate onSubmit={onSubmit}>
          <Stack spacing={2.5}>
            {error && (
              <Alert
                severity="error"
                action={
                  <Button component={RouterLink} to="/forgot-password" color="inherit" size="small">
                    {es.reset.requestNew}
                  </Button>
                }
              >
                {error}
              </Alert>
            )}
            <PasswordField
              control={control}
              name="password"
              label={es.reset.password}
              helperText={es.signUp.passwordHelp}
              autoComplete="new-password"
              autoFocus
              required
            />
            <PasswordField
              control={control}
              name="confirm"
              label={es.reset.confirm}
              autoComplete="new-password"
              required
            />
            <GradientButton type="submit" loading={formState.isSubmitting}>
              {es.reset.submit}
            </GradientButton>
          </Stack>
        </Box>
      )}
      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Link component={RouterLink} to="/login" variant="body2" underline="hover">
          ← {es.common.backToLogin}
        </Link>
      </Box>
    </>
  )
}
