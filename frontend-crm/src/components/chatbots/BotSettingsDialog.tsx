import CloseRounded from '@mui/icons-material/CloseRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { es } from '../../i18n/es'
import type { Chatbot, ChatbotChanges, Schedule } from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'
import { ScheduleEditor } from './ScheduleEditor'

const t = es.chatbots.settings

/** Bolivia (UTC-4), the time zone the bots start with. */
export const DEFAULT_TIMEZONE = 'America/La_Paz'

const WEEKDAYS = [1, 2, 3, 4, 5]

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

const isInt = (value: string, min: number, max: number) => {
  const number = Number(value)
  return value !== '' && Number.isInteger(number) && number >= min && number <= max
}

/** "Configuración del chatbot": its data, how it answers and when it is on. */
export function BotSettingsDialog({
  chatbot,
  onClose,
  onChangeLines,
  onSubmit,
}: {
  chatbot: Chatbot
  onClose: () => void
  /** Opens "Asignar líneas". */
  onChangeLines: () => void
  onSubmit: (changes: ChatbotChanges) => Promise<void>
}) {
  const [name, setName] = useState(chatbot.name)
  const [description, setDescription] = useState(chatbot.description)
  const [fallback, setFallback] = useState(chatbot.fallbackText)
  const [keywords, setKeywords] = useState(chatbot.restartKeywords)
  const [restart, setRestart] = useState(String(chatbot.restartAfterMinutes))
  const [inactivity, setInactivity] = useState(chatbot.inactivityMinutes !== null)
  const [inactivityMinutes, setInactivityMinutes] = useState(String(chatbot.inactivityMinutes ?? 5))
  const [inactivityText, setInactivityText] = useState(
    chatbot.inactivityText || t.inactivityTextDefault,
  )
  const [custom, setCustom] = useState(chatbot.schedule !== null)
  const [schedule, setSchedule] = useState<Schedule>(
    () =>
      chatbot.schedule ?? {
        timezone: DEFAULT_TIMEZONE,
        days: WEEKDAYS.map((day) => ({ day, ranges: [{ from: '08:00', to: '18:00' }] })),
      },
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const validRestart = isInt(restart, 2, 10080)
  const validInactivity =
    !inactivity || (isInt(inactivityMinutes, 1, 29) && inactivityText.trim() !== '')
  const noRanges = custom && schedule.days.every((day) => day.ranges.length === 0)
  const valid = name.trim() !== '' && validRestart && validInactivity

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        fallbackText: fallback.trim(),
        restartKeywords: keywords,
        restartAfterMinutes: Number(restart),
        inactivityMinutes: inactivity ? Number(inactivityMinutes) : null,
        inactivityText: inactivity ? inactivityText.trim() : chatbot.inactivityText,
        schedule: custom ? schedule : null,
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', fontWeight: 700 }}>
        <Box sx={{ flex: 1 }}>{t.title}</Box>
        <IconButton aria-label={es.chatbots.editor.close} onClick={onClose} disabled={busy}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}
          <Block title={t.general}>
            <TextField
              size="small"
              label={t.name}
              value={name}
              required
              error={!name.trim()}
              onChange={(event) => setName(event.target.value.slice(0, 80))}
            />
            <TextField
              size="small"
              label={t.description}
              value={description}
              multiline
              minRows={2}
              helperText={t.descriptionHelp}
              onChange={(event) => setDescription(event.target.value.slice(0, 300))}
            />
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {t.lines}
              </Typography>
              <Stack
                direction="row"
                useFlexGap
                sx={{ flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}
              >
                {chatbot.lines.length === 0 ? (
                  <Typography variant="body2">{t.noLines}</Typography>
                ) : (
                  chatbot.lines.map((line) => <Chip key={line.id} size="small" label={line.name} />)
                )}
                <Button size="small" onClick={onChangeLines} disabled={busy}>
                  {t.changeLines}
                </Button>
              </Stack>
            </Stack>
          </Block>
          <Divider />
          <Block title={t.answers}>
            <TextField
              size="small"
              label={t.fallback}
              value={fallback}
              placeholder={t.fallbackDefault}
              multiline
              minRows={2}
              helperText={t.fallbackHelp}
              onChange={(event) => setFallback(event.target.value.slice(0, 1024))}
            />
            <Autocomplete
              multiple
              freeSolo
              size="small"
              options={[]}
              value={keywords}
              onChange={(_, value) =>
                setKeywords(
                  [...new Set(value.map((word) => word.trim().slice(0, 40)).filter(Boolean))].slice(
                    0,
                    10,
                  ),
                )
              }
              renderInput={(props) => (
                <TextField {...props} label={t.keywords} helperText={t.keywordsHelp} />
              )}
            />
            <TextField
              size="small"
              type="number"
              label={t.restart}
              value={restart}
              onChange={(event) => setRestart(event.target.value)}
              error={!validRestart}
              helperText={t.restartHelp}
              slotProps={{ htmlInput: { min: 2, max: 10080 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={inactivity}
                  onChange={(event) => setInactivity(event.target.checked)}
                />
              }
              label={t.inactivity}
            />
            {inactivity && (
              <Stack spacing={1.5} sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  {t.inactivityHelp}
                </Typography>
                <TextField
                  size="small"
                  type="number"
                  label={t.inactivityMinutes}
                  value={inactivityMinutes}
                  onChange={(event) => setInactivityMinutes(event.target.value)}
                  error={!isInt(inactivityMinutes, 1, 29)}
                  helperText={t.inactivityMinutesHelp}
                  slotProps={{ htmlInput: { min: 1, max: 29 } }}
                />
                <TextField
                  size="small"
                  label={t.inactivityText}
                  value={inactivityText}
                  multiline
                  minRows={2}
                  required
                  error={!inactivityText.trim()}
                  onChange={(event) => setInactivityText(event.target.value.slice(0, 1024))}
                />
              </Stack>
            )}
          </Block>
          <Divider />
          <Block title={t.availability}>
            <FormControlLabel
              control={
                <Switch checked={custom} onChange={(event) => setCustom(event.target.checked)} />
              }
              label={t.custom}
            />
            <Typography variant="body2" color="text.secondary">
              {t.customHelp}
            </Typography>
            {noRanges && <Alert severity="warning">{t.noRanges}</Alert>}
            {custom && <ScheduleEditor value={schedule} onChange={setSchedule} />}
          </Block>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button variant="contained" disabled={busy || !valid} onClick={() => void save()}>
          {t.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
