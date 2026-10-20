import {
  Alert,
  Autocomplete,
  Button,
  Card,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSnackbar } from 'notistack'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { channelsApi, channelKeys } from '../../../lib/api/channels'
import {
  inboxApi,
  inboxKeys,
  type AutoAssignmentOptions,
  type Assignee,
} from '../../../lib/api/inbox'
import { errorMessage } from '../../../lib/api/errors'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

export function AutoAssignmentPage() {
  useDocumentTitle('Autoasignación')
  const { active } = useActiveWorkspace()
  const workspaceId = active?.id ?? ''
  const query = useQuery({
    queryKey: inboxKeys.assignment(workspaceId),
    queryFn: ({ signal }) => inboxApi.assignment(workspaceId, signal),
    enabled: !!workspaceId,
  })
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Autoasignación"
        subtitle="Distribuye los nuevos chats por turnos entre los agentes activos de cada línea."
      />
      {query.isPending && <LinearProgress />}
      {query.error && <Alert severity="error">{errorMessage(query.error)}</Alert>}
      {query.data?.lines.length === 0 && (
        <Alert severity="info">Aún no tienes líneas configuradas.</Alert>
      )}
      {query.data?.lines.map((line) => (
        <AssignmentCard
          key={`${workspaceId}:${line.id}:${line.autoAssign}:${line.membershipIds.join(',')}`}
          workspaceId={workspaceId}
          line={line}
          members={query.data.members}
        />
      ))}
    </Stack>
  )
}

function AssignmentCard({
  workspaceId,
  line,
  members,
}: {
  workspaceId: string
  line: AutoAssignmentOptions['lines'][number]
  members: Assignee[]
}) {
  const [selected, setSelected] = useState(
    members.filter((member) => line.membershipIds.includes(member.membershipId)),
  )
  const [enabled, setEnabled] = useState(line.autoAssign)
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const save = useMutation({
    mutationFn: async () => {
      await channelsApi.setAgents(
        workspaceId,
        line.id,
        selected.map((member) => member.membershipId),
      )
      await channelsApi.update(workspaceId, line.id, { autoAssign: enabled })
    },
    onSuccess: () => enqueueSnackbar('Autoasignación guardada.', { variant: 'success' }),
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: inboxKeys.assignment(workspaceId) })
      void client.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
    },
  })
  return (
    <Card variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">{line.name}</Typography>
        {line.status === 'DISABLED' && (
          <Alert severity="info">Esta línea está desactivada y no recibe nuevos chats.</Alert>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(_, checked) => setEnabled(checked)}
              disabled={save.isPending}
            />
          }
          label="Asignar automáticamente nuevos chats"
        />
        <Autocomplete
          multiple
          options={members}
          value={selected}
          getOptionLabel={(member) => member.name}
          isOptionEqualToValue={(option, value) => option.membershipId === value.membershipId}
          onChange={(_, values) => setSelected(values)}
          disabled={save.isPending}
          renderInput={(props) => <TextField {...props} label="Agentes de la línea" />}
        />
        {!selected.length && (
          <Alert severity="warning">
            Sin agentes activos, los nuevos chats quedarán sin asignar.
          </Alert>
        )}
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          sx={{ alignSelf: 'flex-start' }}
        >
          Guardar configuración
        </Button>
      </Stack>
    </Card>
  )
}
