import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Funnel, FunnelInput } from '../../lib/api/funnels'
import { useInboxOptions } from './useFunnels'

const t = es.funnels.form

/** «Nuevo embudo» and «Editar embudo». */
export function FunnelDialog({
  funnel,
  defaultLineId,
  onSubmit,
  onDelete,
  onClose,
}: {
  /** null: a new funnel. */
  funnel: Funnel | null
  defaultLineId?: string
  onSubmit: (input: FunnelInput & { defaultStages: boolean }) => Promise<void>
  onDelete?: () => void
  onClose: () => void
}) {
  const options = useInboxOptions()
  const lines = (options.data?.lines ?? []).filter(
    (line) => line.status !== 'DISABLED' || line.id === funnel?.lineId,
  )
  const [lineId, setLineId] = useState(funnel?.lineId ?? defaultLineId ?? '')
  const [name, setName] = useState(funnel?.name ?? '')
  const [description, setDescription] = useState(funnel?.description ?? '')
  const [isPrimary, setIsPrimary] = useState(funnel?.isPrimary ?? false)
  const [defaultStages, setDefaultStages] = useState(true)
  const [autoArchive, setAutoArchive] = useState(funnel?.archiveAfterDays != null)
  const [days, setDays] = useState(String(funnel?.archiveAfterDays ?? 30))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dayCount = Number(days)
  const daysValid = !autoArchive || (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365)
  const valid = !!lineId && !!name.trim() && daysValid
  const lineLocked = !!funnel && funnel.leads > 0

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        lineId,
        name: name.trim(),
        description: description.trim(),
        isPrimary,
        archiveAfterDays: autoArchive ? dayCount : null,
        defaultStages,
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {funnel ? es.funnels.editFunnel : es.funnels.newFunnel}
      </DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="funnel-form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            required
            label={t.line}
            value={lines.some((line) => line.id === lineId) ? lineId : ''}
            onChange={(event) => setLineId(event.target.value)}
            disabled={lineLocked}
            helperText={lineLocked ? t.lineLocked : t.lineHelp}
          >
            {lines.map((line) => (
              <MenuItem key={line.id} value={line.id}>
                {line.name}
                {line.displayPhone ? ` · ${line.displayPhone}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            required
            label={t.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <TextField
            label={t.description}
            value={description}
            multiline
            minRows={2}
            onChange={(event) => setDescription(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          <Box>
            <FormControlLabel
              control={
                <Switch checked={isPrimary} onChange={(_, checked) => setIsPrimary(checked)} />
              }
              label={t.isPrimary}
            />
            <Typography variant="caption" color="text.secondary" component="p">
              {t.isPrimaryHelp}
            </Typography>
          </Box>
          {!funnel && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={defaultStages}
                  onChange={(_, checked) => setDefaultStages(checked)}
                />
              }
              label={t.defaultStages}
            />
          )}
          <Box>
            <FormControlLabel
              control={
                <Switch checked={autoArchive} onChange={(_, checked) => setAutoArchive(checked)} />
              }
              label={t.autoArchive}
            />
            {autoArchive && (
              <TextField
                size="small"
                type="number"
                label={t.archiveDays}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                error={!daysValid}
                sx={{ mt: 1, width: 180 }}
                slotProps={{ htmlInput: { min: 1, max: 365 } }}
              />
            )}
            <Typography variant="caption" color="text.secondary" component="p">
              {t.archiveHelp}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {funnel && onDelete && (
          <Button color="error" onClick={onDelete} disabled={busy} sx={{ mr: 'auto' }}>
            {es.funnels.deleteFunnel}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button type="submit" form="funnel-form" variant="contained" disabled={busy || !valid}>
          {funnel ? es.common.save : t.create}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
