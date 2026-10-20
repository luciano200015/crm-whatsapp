import { zodResolver } from '@hookform/resolvers/zod'
import ComputerOutlined from '@mui/icons-material/ComputerOutlined'
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useForm } from 'react-hook-form'
import { PageHeader } from '../../components/PageHeader'
import { PasswordField } from '../../components/form/PasswordField'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { authApi } from '../../lib/api/auth'
import { describeDevice } from '../../lib/device'
import { errorMessage } from '../../lib/api/errors'
import type { Session } from '../../lib/api/types'
import { changePasswordSchema, type ChangePasswordValues } from '../../lib/validation'

const sessionsKey = ['auth', 'sessions'] as const

export function SecurityPage() {
  useDocumentTitle(es.security.title)
  return (
    <>
      <PageHeader title={es.security.title} />
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <ChangePasswordCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SessionsCard />
        </Grid>
      </Grid>
    </>
  )
}

function ChangePasswordCard() {
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { control, handleSubmit, reset } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })

  const change = useMutation({
    mutationFn: (values: ChangePasswordValues) =>
      authApi.changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      reset()
      void queryClient.invalidateQueries({ queryKey: sessionsKey })
      enqueueSnackbar(es.security.changed, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {es.security.changePassword}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {es.security.changePasswordHelp}
        </Typography>
        <Box component="form" noValidate onSubmit={handleSubmit((v) => change.mutate(v))}>
          <Stack spacing={2.5}>
            <PasswordField
              control={control}
              name="currentPassword"
              label={es.security.current}
              autoComplete="current-password"
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
            <Box>
              <Button type="submit" variant="contained" disabled={change.isPending}>
                {es.security.submit}
              </Button>
            </Box>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const sessions = useQuery({ queryKey: sessionsKey, queryFn: () => authApi.listSessions() })

  const onError = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })
  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionsKey })

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      void refresh()
      enqueueSnackbar(es.security.revoked, { variant: 'success' })
    },
    onError,
  })
  const revokeOthers = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: ({ revoked }) => {
      void refresh()
      enqueueSnackbar(es.security.revokedOthers(revoked), { variant: 'success' })
    },
    onError,
  })

  const others = sessions.data?.filter((s) => !s.current).length ?? 0

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, mb: 2 }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {es.security.sessions}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {es.security.sessionsHelp}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="error"
            disabled={others === 0 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {es.security.revokeOthers}
          </Button>
        </Stack>

        {sessions.isPending ? (
          <Skeleton variant="rounded" height={160} />
        ) : (
          <Stack divider={<Divider flexItem />}>
            {sessions.data?.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                disabled={revoke.isPending}
                onRevoke={() => revoke.mutate(session.id)}
              />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

function SessionRow({
  session,
  disabled,
  onRevoke,
}: {
  session: Session
  disabled: boolean
  onRevoke: () => void
}) {
  const device = describeDevice(session.userAgent)
  const Icon = device.mobile ? PhoneIphoneOutlined : ComputerOutlined
  return (
    <Stack direction="row" spacing={2} sx={{ py: 1.5, alignItems: 'center' }}>
      <Icon sx={{ color: 'text.secondary' }} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {device.label}
          </Typography>
          {session.current && <Chip size="small" color="primary" label={es.security.current_} />}
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {session.ipAddress ?? '—'} · {es.security.lastUsed}: {formatDate(session.lastUsedAt)} ·{' '}
          {es.security.started}: {formatDate(session.createdAt)}
        </Typography>
      </Box>
      {!session.current && (
        <Button size="small" color="error" disabled={disabled} onClick={onRevoke}>
          {es.security.revoke}
        </Button>
      )}
    </Stack>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}
