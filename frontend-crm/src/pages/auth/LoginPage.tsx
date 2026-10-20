import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/auth-context'
import { safeRedirect } from '../../lib/redirect'
import { GradientButton } from '../../components/GradientButton'
import { FormTextField } from '../../components/form/FormTextField'
import { PasswordField } from '../../components/form/PasswordField'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import { loginSchema, type LoginValues } from '../../lib/validation'
import { AuthHeader } from '../../layouts/AuthLayout'
import { themeConfig } from '../../theme/theme.config'

export function LoginPage() {
  useDocumentTitle(es.login.title)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  const { control, handleSubmit, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null)
    try {
      await login(email, password)
      void navigate(safeRedirect(params.get('redirect')), { replace: true })
    } catch (caught: unknown) {
      // The API answers the same generic 401 for every credential problem.
      setError(errorMessage(caught, { 401: es.errors.invalidCredentials }))
    }
  })

  return (
    <>
      <AuthHeader title={es.login.welcome(themeConfig.brand.name)} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <FormTextField
            control={control}
            name="email"
            label={es.login.email}
            placeholder={es.login.emailPlaceholder}
            type="email"
            autoComplete="username"
            autoFocus
            required
          />
          <PasswordField
            control={control}
            name="password"
            label={es.login.password}
            placeholder={es.login.passwordPlaceholder}
            autoComplete="current-password"
            required
          />
          <Box sx={{ textAlign: 'center' }}>
            <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
              {es.login.forgot}
            </Link>
          </Box>
          <GradientButton type="submit" loading={formState.isSubmitting}>
            {es.login.submit}
          </GradientButton>
        </Stack>
      </Box>
      <Typography variant="body2" sx={{ textAlign: 'center', mt: 3, color: 'text.secondary' }}>
        {es.login.noAccount}{' '}
        <Link component={RouterLink} to="/sign-up" underline="hover" sx={{ fontWeight: 600 }}>
          {es.login.signUp}
        </Link>
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'center', mt: 1 }}>
        <Link component={RouterLink} to="/pricing" underline="hover">
          {es.login.seePlans}
        </Link>
      </Typography>
    </>
  )
}
