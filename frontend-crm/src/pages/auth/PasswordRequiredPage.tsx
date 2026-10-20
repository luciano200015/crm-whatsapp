import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import { useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../../auth/auth-context'
import { useMe } from '../../auth/useMe'
import { GradientButton } from '../../components/GradientButton'
import { PasswordField } from '../../components/form/PasswordField'
import { SplashScreen } from '../../components/SplashScreen'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { AuthHeader } from '../../layouts/AuthLayout'
import { authApi } from '../../lib/api/auth'
import { errorMessage } from '../../lib/api/errors'
import { meQueryKey } from '../../lib/api/users'
import { changePasswordSchema, type ChangePasswordValues } from '../../lib/validation'

/**
 * First sign-in of an agent created by an admin: the temporary password from
 * the email must be replaced before anything else (the API enforces it too).
 */
export function PasswordRequiredPage() {
  useDocumentTitle(es.passwordRequired.title)
  const { data: me, isPending } = useMe()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [error, setError] = useState<string | null>(null)

  const { control, handleSubmit, formState } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      await queryClient.invalidateQueries({ queryKey: meQueryKey })
      enqueueSnackbar(es.passwordRequired.done, { variant: 'success' })
      void navigate('/', { replace: true })
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  if (isPending) return <SplashScreen />
  if (me && !me.mustChangePassword) return <Navigate to="/" replace />

  return (
    <>
      <AuthHeader title={es.passwordRequired.heading} subtitle={es.passwordRequired.body} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          <PasswordField
            control={control}
            name="currentPassword"
            label={es.passwordRequired.current}
            autoComplete="current-password"
            autoFocus
            required
          />
          <PasswordField
            control={control}
            name="newPassword"
            label={es.security.newPassword}
            helperText={es.signUp.passwordHelp}
            autoComplete="new-password"
            required
          />
          <PasswordField
            control={control}
            name="confirm"
            label={es.security.confirm}
            autoComplete="new-password"
            required
          />
          <GradientButton type="submit" loading={formState.isSubmitting}>
            {es.passwordRequired.submit}
          </GradientButton>
        </Stack>
      </Box>
      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          underline="hover"
          onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
        >
          {es.passwordRequired.logout}
        </Link>
      </Box>
    </>
  )
}
