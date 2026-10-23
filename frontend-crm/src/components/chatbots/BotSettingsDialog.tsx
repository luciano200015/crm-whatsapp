import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import type { Chatbot, Schedule } from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'
import { defaultData } from './flow-model'
import { ScheduleEditor } from './ScheduleEditor'

/** When the chatbot answers, and after how long a quiet chat starts over. */
export function BotSettingsDialog({
  chatbot,
  onClose,
  onSubmit,
}: {
  chatbot: Chatbot
  onClose: () => void
  onSubmit: (changes: { schedule: Schedule | null; restartAfterMinutes: number }) => Promise<void>
}) {
  const t = es.chatbots.settings
  const [custom, setCustom] = useState(chatbot.schedule !== null)
  const [schedule, setSchedule] = useState<Schedule>(
    () => chatbot.schedule ?? (defaultData('hours') as { schedule: Schedule }).schedule,
  )
  const [restart, setRestart] = useState(String(chatbot.restartAfterMinutes))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const minutes = Number(restart)
  const validRestart = Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ schedule: custom ? schedule : null, restartAfterMinutes: minutes })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="subtitle2">{t.availability}</Typography>
          <RadioGroup
            value={custom ? 'custom' : 'always'}
            onChange={(event) => setCustom(event.target.value === 'custom')}
          >
            <FormControlLabel value="always" control={<Radio size="small" />} label={t.always} />
            <FormControlLabel value="custom" control={<Radio size="small" />} label={t.custom} />
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            {t.availabilityHelp}
          </Typography>
          {custom && <ScheduleEditor value={schedule} onChange={setSchedule} />}
          <TextField
            size="small"
            type="number"
            label={t.restart}
            value={restart}
            onChange={(event) => setRestart(event.target.value)}
            error={!validRestart}
            helperText={t.restartHelp}
            slotProps={{ htmlInput: { min: 5, max: 10080 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button variant="contained" disabled={busy || !validRestart} onClick={() => void save()}>
          {t.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
