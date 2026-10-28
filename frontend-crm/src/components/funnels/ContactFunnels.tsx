import { ListSubheader, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { usePermissions } from '../../auth/usePermissions'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import { funnelKeys, funnelsApi, type ContactFunnel } from '../../lib/api/funnels'
import { useContactFunnels } from './useFunnels'

const t = es.funnels.chat

/**
 * The stage of the contact in each funnel, to change it from the chat. A
 * contact out of a funnel enters it by choosing a stage.
 */
export function ContactFunnels({
  workspaceId,
  contactId,
  lineId,
  direction = 'column',
}: {
  workspaceId: string
  contactId: string
  /** The chat's line: its funnels go first. */
  lineId?: string
  direction?: 'row' | 'column'
}) {
  const { has } = usePermissions()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { query, own, others } = useContactFunnels(workspaceId, contactId, lineId)
  const move = useMutation({
    mutationFn: ({ funnelId, stageId }: { funnelId: string; stageId: string }) =>
      funnelsApi.setContactStage(workspaceId, contactId, funnelId, stageId),
    onSuccess: (funnels) => {
      client.setQueryData(funnelKeys.contact(workspaceId, contactId), funnels)
      enqueueSnackbar(t.stageSaved, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) }),
  })
  if (query.error || (query.data && query.data.length === 0)) return null
  const row = (funnel: ContactFunnel) => (
    <TextField
      key={funnel.funnelId}
      select
      size="small"
      label={funnel.funnelName}
      value={funnel.lead?.stageId ?? ''}
      disabled={!has('funnels.write') || move.isPending}
      onChange={(event) => move.mutate({ funnelId: funnel.funnelId, stageId: event.target.value })}
      sx={{ minWidth: 200 }}
      slotProps={{
        select: {
          displayEmpty: true,
          renderValue: (value) =>
            funnel.stages.find((stage) => stage.id === value)?.name ?? (
              <Typography component="span" color="text.secondary">
                {t.outside}
              </Typography>
            ),
        },
        inputLabel: { shrink: true },
      }}
    >
      {funnel.stages.map((stage) => (
        <MenuItem key={stage.id} value={stage.id}>
          {stage.name}
        </MenuItem>
      ))}
    </TextField>
  )
  return (
    <Stack direction={direction} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {own.map(row)}
      {others.length > 0 && own.length > 0 && direction === 'column' && (
        <ListSubheader disableGutters sx={{ lineHeight: 2, bgcolor: 'transparent' }}>
          {t.otherFunnels}
        </ListSubheader>
      )}
      {others.map(row)}
    </Stack>
  )
}
