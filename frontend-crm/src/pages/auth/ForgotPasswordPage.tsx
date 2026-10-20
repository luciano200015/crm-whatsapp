import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import { GradientButton } from '../../components/GradientButton'
import { FormTextField } from '../../components/form/FormTextField'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { authApi } from '../../lib/api/auth'
import { errorMessage } from '../../lib/api/errors'
import { forgotSchema, type ForgotValues } from '../../lib/validation'
import { AuthHeader } from '../../layouts/AuthLayout'

export function ForgotPasswordPage() {
  useDocumentTitle(es.forgot.title)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { control, handleSubmit, formState } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <>
      <AuthHeader title={es.forgot.heading} subtitle={!sent && es.forgot.body} />
      {sent ? (
        <Alert severity="success">{es.forgot.sent}</Alert>
      ) : (
        <Box component="form" noValidate onSubmit={onSubmit}>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormTextField
              control={control}
              name="email"
              label={es.forgot.email}
              placeholder={es.login.emailPlaceholder}
              type="email"
              autoComplete="email"
              autoFocus
              required
            />
            <GradientButton type="submit" loading={formState.isSubmitting}>
              {es.forgot.submit}
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
