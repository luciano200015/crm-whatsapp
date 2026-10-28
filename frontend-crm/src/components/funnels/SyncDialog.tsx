import AddRounded from '@mui/icons-material/AddRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import { CHAT_STATUSES, type ChatStatus, type Funnel, type SyncRule } from '../../lib/api/funnels'

const t = es.funnels.syncForm

/**
 * «Sincronizar contactos»: chats of the line in each status become leads of
 * a stage. Contacts already in the funnel keep their stage.
 */
export function SyncDialog({
  funnel,
  onSubmit,
  onClose,
}: {
  funnel: Funnel
  onSubmit: (rules: SyncRule[]) => Promise<{ created: number; skipped: number; failed: number }>
  onClose: () => void
}) {
  const [rules, setRules] = useState<SyncRule[]>(() =>
    funnel.syncRules.length > 0
      ? funnel.syncRules
      : [{ status: 'OPEN', stageId: funnel.stages[0]?.id ?? '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const used = new Set(rules.map((rule) => rule.status))
  const valid = rules.length > 0 && rules.every((rule) => rule.stageId)
  const update = (index: number, changes: Partial<SyncRule>) =>
    setRules(rules.map((rule, at) => (at === index ? { ...rule, ...changes } : rule)))

  const submit = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const done = await onSubmit(rules)
      setResult(t.result(done.created, done.skipped, done.failed))
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{t.help}</DialogContentText>
          {error && <Alert severity="error">{error}</Alert>}
          {result && (
            <Alert severity="success" role="status">
              {result}
            </Alert>
          )}
          {rules.map((rule, index) => (
            <Stack key={rule.status} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                select
                size="small"
                label={t.from}
                value={rule.status}
                onChange={(event) => update(index, { status: event.target.value as ChatStatus })}
                sx={{ flex: 1 }}
              >
                {CHAT_STATUSES.filter((status) => status === rule.status || !used.has(status)).map(
                  (status) => (
                    <MenuItem key={status} value={status}>
                      {es.funnels.statuses[status]}
                    </MenuItem>
                  ),
                )}
              </TextField>
              <TextField
                select
                size="small"
                label={t.to}
                value={rule.stageId}
                onChange={(event) => update(index, { stageId: event.target.value })}
                sx={{ flex: 1 }}
              >
                {funnel.stages.map((stage) => (
                  <MenuItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </MenuItem>
                ))}
              </TextField>
              <IconButton
                aria-label={t.removeRule}
                onClick={() => setRules(rules.filter((_, at) => at !== index))}
              >
                <DeleteOutlineRounded />
              </IconButton>
            </Stack>
          ))}
          {rules.length === 0 && <Alert severity="info">{t.noRules}</Alert>}
          {rules.length < CHAT_STATUSES.length && (
            <Button
              startIcon={<AddRounded />}
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => {
                const status = CHAT_STATUSES.find((item) => !used.has(item))
                if (status) setRules([...rules, { status, stageId: funnel.stages[0]?.id ?? '' }])
              }}
            >
              {t.addRule}
            </Button>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.funnels.chat.close}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !valid}>
          {t.run}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
