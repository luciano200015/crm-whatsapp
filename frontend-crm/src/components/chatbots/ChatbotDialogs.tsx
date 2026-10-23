import CheckBoxOutlineBlankRounded from '@mui/icons-material/CheckBoxOutlineBlankRounded'
import CheckBoxRounded from '@mui/icons-material/CheckBoxRounded'
import WhatsApp from '@mui/icons-material/WhatsApp'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { channelKeys, channelsApi } from '../../lib/api/channels'
import type { ChatbotSummary } from '../../lib/api/chatbots'
import { ApiError, errorMessage } from '../../lib/api/errors'
import { ConfirmDialog } from '../ConfirmDialog'

/** Name of a new chatbot, or a new name for one. */
export function ChatbotNameDialog({
  initial,
  onClose,
  onSubmit,
}: {
  /** null: creating a chatbot. */
  initial: string | null
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const submit = async () => {
    if (!trimmed || trimmed.length > 80) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {initial === null ? es.chatbots.form.createTitle : es.chatbots.form.renameTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={es.chatbots.form.name}
              placeholder={es.chatbots.form.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
              fullWidth
              error={trimmed.length > 80}
              helperText={trimmed.length > 80 ? es.validation.maxLength(80) : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={busy}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !trimmed}>
            {initial === null ? es.chatbots.form.create : es.chatbots.form.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

/**
 * Lines a chatbot answers on. A line of another chatbot can be moved here
 * after confirming (one chatbot per line).
 */
export function ChatbotLinesDialog({
  workspaceId,
  chatbot,
  chatbots,
  onClose,
  onSubmit,
}: {
  workspaceId: string
  chatbot: ChatbotSummary
  chatbots: ChatbotSummary[]
  onClose: () => void
  onSubmit: (lineIds: string[], takeOver: boolean) => Promise<void>
}) {
  const lines = useQuery({
    queryKey: channelKeys.lines(workspaceId),
    queryFn: () => channelsApi.lines(workspaceId),
  })
  const [chosen, setChosen] = useState(() => chatbot.lines.map((line) => line.id))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<{ line: string; bot: string } | null>(null)
  // Who answers each line today (lines of the list come with the chatbots).
  const ownerOf = new Map(
    chatbots.flatMap((bot) => bot.lines.map((line) => [line.id, bot] as const)),
  )

  const save = async (takeOver: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(chosen, takeOver)
      onClose()
    } catch (caught: unknown) {
      setBusy(false)
      if (caught instanceof ApiError && caught.body?.code === 'LINE_HAS_CHATBOT') {
        const details = caught.body.details ?? {}
        setConflict({ line: String(details.lineName ?? ''), bot: String(details.chatbot ?? '') })
        return
      }
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {es.chatbots.linesDialog.title(chatbot.name)}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {es.chatbots.linesDialog.help}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {lines.error && <Alert severity="error">{errorMessage(lines.error)}</Alert>}
            {lines.data?.length === 0 && (
              <Alert severity="info">{es.chatbots.linesDialog.empty}</Alert>
            )}
            <List dense disablePadding>
              {(lines.data ?? []).map((line) => {
                const checked = chosen.includes(line.id)
                const owner = ownerOf.get(line.id)
                return (
                  <ListItemButton
                    key={line.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={line.name}
                    onClick={() =>
                      setChosen((current) =>
                        checked ? current.filter((id) => id !== line.id) : [...current, line.id],
                      )
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {checked ? (
                        <CheckBoxRounded color="primary" />
                      ) : (
                        <CheckBoxOutlineBlankRounded />
                      )}
                    </ListItemIcon>
                    <WhatsApp sx={{ color: line.color ?? '#25d366', mr: 1.5 }} />
                    <ListItemText
                      primary={line.name}
                      secondary={line.displayPhone ?? line.phoneNumberId}
                    />
                    {owner && owner.id !== chatbot.id && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="warning"
                        label={es.chatbots.linesDialog.usedBy(owner.name)}
                      />
                    )}
                  </ListItemButton>
                )
              })}
            </List>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={busy}>
            {es.common.cancel}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !lines.data}
            onClick={() => void save(false)}
          >
            {es.chatbots.linesDialog.save}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={!!conflict}
        title={es.chatbots.linesDialog.takeOverTitle}
        confirmLabel={es.chatbots.linesDialog.move}
        loading={busy}
        onClose={() => setConflict(null)}
        onConfirm={() => {
          setConflict(null)
          void save(true)
        }}
      >
        {conflict && es.chatbots.linesDialog.takeOver(conflict.line, conflict.bot)}
      </ConfirmDialog>
    </>
  )
}
