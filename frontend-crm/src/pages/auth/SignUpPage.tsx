import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { useCatalog } from '../../components/billing/useCatalog'
import { GradientButton } from '../../components/GradientButton'
import { FormTextField } from '../../components/form/FormTextField'
import { PasswordField } from '../../components/form/PasswordField'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { authApi } from '../../lib/api/auth'
import { errorMessage } from '../../lib/api/errors'
import type { BillingInterval } from '../../lib/api/types'
import { signUpSchema, type SignUpValues } from '../../lib/validation'
import { AuthHeader } from '../../layouts/AuthLayout'
import { themeConfig } from '../../theme/theme.config'

export function SignUpPage() {
  useDocumentTitle(es.signUp.title)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [params] = useSearchParams()
  const catalog = useCatalog()

  // Plan chosen on the pricing page (?plan=business&interval=YEAR); otherwise the default plan.
  const interval: BillingInterval = params.get('interval') === 'YEAR' ? 'YEAR' : 'MONTH'
  const plan =
    catalog.data?.plans.find((p) => p.code === params.get('plan')) ??
    catalog.data?.plans.find((p) => p.code === catalog.data.defaultPlan)
  const trialDays = catalog.data?.trialDays ?? 0

  const { control, handleSubmit, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      displayName: '',
      email: '',
      confirmEmail: '',
      workspaceName: '',
      password: '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await authApi.register({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        workspaceName: values.workspaceName,
        ...(plan && { planCode: plan.code, interval }),
      })
      void navigate('/sign-up/done', { state: { email: values.email } })
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <>
      <AuthHeader title={es.signUp.heading(themeConfig.brand.name)} subtitle={es.signUp.subtitle} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.25}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <FormTextField
            control={control}
            name="displayName"
            label={es.signUp.fullName}
            placeholder={es.signUp.fullNamePlaceholder}
            autoComplete="name"
            autoFocus
            required
          />
          <FormTextField
            control={control}
            name="email"
            label={es.signUp.email}
            placeholder={es.signUp.emailPlaceholder}
            type="email"
            autoComplete="email"
            required
          />
          <FormTextField
            control={control}
            name="confirmEmail"
            label={es.signUp.confirmEmail}
            placeholder={es.signUp.confirmEmailPlaceholder}
            type="email"
            autoComplete="off"
            required
          />
          <FormTextField
            control={control}
            name="workspaceName"
            label={es.signUp.company}
            placeholder={es.signUp.companyPlaceholder}
            helperText={es.signUp.companyHelp}
            autoComplete="organization"
            required
          />
          <PasswordField
            control={control}
            name="password"
            label={es.signUp.password}
            placeholder={es.signUp.passwordPlaceholder}
            helperText={es.signUp.passwordHelp}
            autoComplete="new-password"
            required
          />
          {plan && (
            <Alert
              severity="info"
              icon={false}
              action={
                <Link
                  component={RouterLink}
                  to="/pricing"
                  underline="hover"
                  sx={{ fontWeight: 600 }}
                >
                  {es.signUp.changePlan}
                </Link>
              }
            >
              <strong>
                {es.signUp.selectedPlan}: {plan.name} ·{' '}
                {interval === 'YEAR' ? es.billing.yearly : es.billing.monthly}
              </strong>
              {trialDays > 0 && (
                <Box component="span" sx={{ display: 'block' }}>
                  {es.signUp.trialNote(trialDays, plan.name)}
                </Box>
              )}
            </Alert>
          )}
          <Typography variant="caption" sx={{ textAlign: 'center', color: 'text.secondary' }}>
            {es.signUp.terms}
          </Typography>
          <GradientButton type="submit" loading={formState.isSubmitting}>
            {trialDays > 0 ? es.signUp.startTrial(trialDays) : es.signUp.submit}
          </GradientButton>
        </Stack>
      </Box>
      <Typography variant="body2" sx={{ textAlign: 'center', mt: 3, color: 'text.secondary' }}>
        {es.signUp.haveAccount}{' '}
        <Link component={RouterLink} to="/login" underline="hover" sx={{ fontWeight: 600 }}>
          {es.signUp.login}
        </Link>
      </Typography>
    </>
  )
}
