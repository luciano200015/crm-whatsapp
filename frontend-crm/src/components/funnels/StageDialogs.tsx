import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { FunnelStage } from '../../lib/api/funnels'

const t = es.funnels.stage

/** «+ Etapa» and «Renombrar». */
export function StageNameDialog({
  stage,
  onSubmit,
  onClose,
}: {
  /** null: a new stage. */
  stage: FunnelStage | null
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(stage?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{stage ? t.rename : t.new}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="stage-form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            required
            label={t.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button type="submit" form="stage-form" variant="contained" disabled={busy || !name.trim()}>
          {es.common.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Deleting a stage: with leads, they must go to another stage first. */
export function StageDeleteDialog({
  stage,
  leads,
  stages,
  onSubmit,
  onClose,
}: {
  stage: FunnelStage
  /** Leads in the stage (active and archived). */
  leads: number
  stages: FunnelStage[]
  onSubmit: (moveTo: string | undefined) => Promise<void>
  onClose: () => void
}) {
  const others = stages.filter((item) => item.id !== stage.id)
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(leads > 0 ? moveTo : undefined)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.removeTitle(stage.name)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <DialogContentText>
            {leads > 0 ? t.removeWithLeads(leads) : t.removeEmpty}
          </DialogContentText>
          {leads > 0 && (
            <TextField
              select
              required
              label={t.moveTo}
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
            >
              {others.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void submit()}
          disabled={busy || (leads > 0 && !moveTo)}
        >
          {t.remove}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
