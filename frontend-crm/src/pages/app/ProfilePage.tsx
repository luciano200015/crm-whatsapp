import { zodResolver } from '@hookform/resolvers/zod'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import FormLabel from '@mui/material/FormLabel'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { Controller, useForm } from 'react-hook-form'
import { useMe } from '../../auth/useMe'
import { FormTextField } from '../../components/form/FormTextField'
import { PageHeader } from '../../components/PageHeader'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Me } from '../../lib/api/types'
import { meQueryKey, usersApi } from '../../lib/api/users'
import { profileSchema, type ProfileValues } from '../../lib/validation'

const TIME_ZONES = Intl.supportedValuesOf('timeZone')

export function ProfilePage() {
  useDocumentTitle(es.profile.title)
  const { data: me } = useMe()

  return (
    <>
      <PageHeader title={es.profile.title} subtitle={es.profile.subtitle} />
      <Card variant="outlined" sx={{ maxWidth: 640 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          {me ? <ProfileForm me={me} /> : <Skeleton variant="rounded" height={260} />}
        </CardContent>
      </Card>
    </>
  )
}

function ProfileForm({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { control, handleSubmit, formState, reset } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: me.displayName,
      locale: me.locale ?? '',
      timezone: me.timezone ?? '',
    },
  })

  const save = useMutation({
    mutationFn: (values: ProfileValues) =>
      usersApi.updateMe({
        displayName: values.displayName,
        locale: values.locale || null,
        timezone: values.timezone || null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(meQueryKey, updated)
      reset({
        displayName: updated.displayName,
        locale: updated.locale ?? '',
        timezone: updated.timezone ?? '',
      })
      enqueueSnackbar(es.profile.saved, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  return (
    <Box component="form" noValidate onSubmit={handleSubmit((values) => save.mutate(values))}>
      <Stack spacing={2.5}>
        <TextField label={es.profile.email} value={me.email} disabled />
        <FormTextField
          control={control}
          name="displayName"
          label={es.profile.displayName}
          required
        />
        <FormTextField
          control={control}
          name="locale"
          label={es.profile.locale}
          placeholder="es-BO"
        />
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <Box>
              <FormLabel
                htmlFor="timezone"
                sx={{ display: 'block', mb: 0.75, fontSize: 13, fontWeight: 600 }}
              >
                {es.profile.timezone}
              </FormLabel>
              <Autocomplete
                id="timezone"
                options={TIME_ZONES}
                value={field.value || null}
                onChange={(_event, value) => field.onChange(value ?? '')}
                renderInput={(params) => <TextField {...params} placeholder="America/La_Paz" />}
              />
            </Box>
          )}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={!formState.isDirty || save.isPending}>
            {es.common.save}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
