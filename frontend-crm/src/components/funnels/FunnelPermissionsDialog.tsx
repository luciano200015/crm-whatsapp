import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import { funnelKeys, funnelsApi, type FunnelPermissions } from '../../lib/api/funnels'

const t = es.funnels.permissionsForm

/** «Privilegios del embudo»: the stages each agent sees (none chosen: all). */
export function FunnelPermissionsDialog({
  workspaceId,
  funnelId,
  onSubmit,
  onClose,
}: {
  workspaceId: string
  funnelId: string
  onSubmit: (members: { membershipId: string; stageIds: string[] }[]) => Promise<void>
  onClose: () => void
}) {
  const current = useQuery({
    queryKey: funnelKeys.permissions(workspaceId, funnelId),
    queryFn: ({ signal }) => funnelsApi.permissions(workspaceId, funnelId, signal),
  })
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      {current.data ? (
        <PermissionsForm initial={current.data} onSubmit={onSubmit} onClose={onClose} />
      ) : (
        <DialogContent>
          {current.error ? (
            <Alert severity="error">{errorMessage(current.error)}</Alert>
          ) : (
            <CircularProgress size={24} />
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

function PermissionsForm({
  initial,
  onSubmit,
  onClose,
}: {
  initial: FunnelPermissions
  onSubmit: (members: { membershipId: string; stageIds: string[] }[]) => Promise<void>
  onClose: () => void
}) {
  const [members, setMembers] = useState(initial.members)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(members.map(({ membershipId, stageIds }) => ({ membershipId, stageIds })))
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{t.help}</DialogContentText>
          {error && <Alert severity="error">{error}</Alert>}
          {members.length === 0 && <Alert severity="info">{t.noMembers}</Alert>}
          {members.map((member) => (
            <Stack key={member.membershipId} spacing={0.5}>
              <Typography variant="subtitle2">{member.name}</Typography>
              <Autocomplete
                multiple
                size="small"
                options={initial.stages}
                value={initial.stages.filter((stage) => member.stageIds.includes(stage.id))}
                getOptionLabel={(stage) => stage.name}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(_, chosen) =>
                  setMembers(
                    members.map((item) =>
                      item.membershipId === member.membershipId
                        ? { ...item, stageIds: chosen.map((stage) => stage.id) }
                        : item,
                    ),
                  )
                }
                renderInput={(props) => (
                  <TextField
                    {...props}
                    label={`${t.stages} · ${member.name}`}
                    placeholder={member.stageIds.length === 0 ? t.all : undefined}
                  />
                )}
              />
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy}>
          {es.common.save}
        </Button>
      </DialogActions>
    </>
  )
}
