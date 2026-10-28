import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import {
  CHAT_STATUSES,
  funnelKeys,
  funnelsApi,
  type AutomationRule,
  type ChatStatus,
  type FunnelSummary,
} from '../../lib/api/funnels'
import { useFunnel, useFunnelList, useInboxOptions } from './useFunnels'

const t = es.funnels.automationForm

/**
 * «Automatización por estado del chat»: when a chat of the line changes to a
 * status, its contact goes to a stage (one rule per line and status).
 */
export function AutomationDialog({
  workspaceId,
  defaultLineId,
  onSubmit,
  onClose,
}: {
  workspaceId: string
  defaultLineId?: string
  onSubmit: (lineId: string, rules: AutomationRule[]) => Promise<void>
  onClose: () => void
}) {
  const options = useInboxOptions()
  const lines = options.data?.lines ?? []
  const [lineId, setLineId] = useState(defaultLineId ?? '')
  const selected = lineId || lines[0]?.id || ''
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{t.help}</DialogContentText>
          <TextField
            select
            size="small"
            label={t.line}
            value={lines.some((line) => line.id === selected) ? selected : ''}
            onChange={(event) => setLineId(event.target.value)}
          >
            {lines.map((line) => (
              <MenuItem key={line.id} value={line.id}>
                {line.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      {selected ? (
        <RulesForm
          key={selected}
          workspaceId={workspaceId}
          lineId={selected}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      ) : (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>{es.common.cancel}</Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

function RulesForm({
  workspaceId,
  lineId,
  onSubmit,
  onClose,
}: {
  workspaceId: string
  lineId: string
  onSubmit: (lineId: string, rules: AutomationRule[]) => Promise<void>
  onClose: () => void
}) {
  const current = useQuery({
    queryKey: funnelKeys.automation(workspaceId, lineId),
    queryFn: ({ signal }) => funnelsApi.automation(workspaceId, lineId, signal),
  })
  const funnels = useFunnelList()
  if (!current.data || !funnels.data) {
    return (
      <DialogContent>
        {current.error || funnels.error ? (
          <Alert severity="error">{errorMessage(current.error ?? funnels.error)}</Alert>
        ) : (
          <CircularProgress size={24} />
        )}
      </DialogContent>
    )
  }
  return (
    <RulesEditor
      lineId={lineId}
      initial={current.data}
      funnels={funnels.data.filter((funnel) => funnel.lineId === lineId)}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

function RulesEditor({
  lineId,
  initial,
  funnels,
  onSubmit,
  onClose,
}: {
  lineId: string
  initial: AutomationRule[]
  funnels: FunnelSummary[]
  onSubmit: (lineId: string, rules: AutomationRule[]) => Promise<void>
  onClose: () => void
}) {
  const [rules, setRules] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = rules.every((rule) => rule.funnelId && rule.stageId)
  const change = (status: ChatStatus, rule: AutomationRule | null) =>
    setRules([...rules.filter((item) => item.status !== status), ...(rule ? [rule] : [])])
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(lineId, rules)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {CHAT_STATUSES.map((status) => (
            <RuleRow
              key={status}
              status={status}
              rule={rules.find((rule) => rule.status === status) ?? null}
              funnels={funnels}
              onChange={(rule) => change(status, rule)}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !valid}>
          {es.common.save}
        </Button>
      </DialogActions>
    </>
  )
}

function RuleRow({
  status,
  rule,
  funnels,
  onChange,
}: {
  status: ChatStatus
  rule: AutomationRule | null
  funnels: FunnelSummary[]
  onChange: (rule: AutomationRule | null) => void
}) {
  const funnel = useFunnel(rule?.funnelId ?? '')
  const stages = funnel.data?.stages ?? []
  const label = es.funnels.statuses[status]
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{label}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          select
          size="small"
          label={`${t.funnel} · ${label}`}
          value={rule?.funnelId ?? ''}
          onChange={(event) =>
            onChange(
              event.target.value ? { status, funnelId: event.target.value, stageId: '' } : null,
            )
          }
          sx={{ flex: 1 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">{t.none}</MenuItem>
          {funnels.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {item.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={`${t.stage} · ${label}`}
          disabled={!rule}
          value={rule && stages.some((stage) => stage.id === rule.stageId) ? rule.stageId : ''}
          onChange={(event) => rule && onChange({ ...rule, stageId: event.target.value })}
          sx={{ flex: 1 }}
        >
          {stages.map((stage) => (
            <MenuItem key={stage.id} value={stage.id}>
              {stage.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  )
}
