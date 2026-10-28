import CloseRounded from '@mui/icons-material/CloseRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { es } from '../../i18n/es'
import { ApiError, errorMessage } from '../../lib/api/errors'
import { funnelKeys, funnelsApi, type Funnel } from '../../lib/api/funnels'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
import { ConfirmDialog } from '../ConfirmDialog'
import { ConversationPanel } from '../inbox/ConversationPanel'
import { ContactFunnels } from './ContactFunnels'
import { useContactFunnels } from './useFunnels'
import { moneyInput, parseMoney } from './funnel-format'

const t = es.funnels.chat

export interface LeadChat {
  contactId: string
  name: string
  /** undefined: look it up; null: the contact has no chat on the line. */
  conversationId?: string | null
  /** False: another agent's chat, which you cannot see. */
  visible?: boolean
}

/**
 * The chat of a lead without leaving the board: its stage in each funnel,
 * its value, archive and remove on top, and the conversation below.
 */
export function LeadChatDialog({
  workspaceId,
  funnel,
  chat,
  onClose,
}: {
  workspaceId: string
  funnel: Funnel
  chat: LeadChat
  onClose: () => void
}) {
  const { has } = usePermissions()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const canWrite = has('funnels.write')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const found = useQuery({
    queryKey: [...inboxKeys.all(workspaceId), 'lead-chat', chat.contactId, funnel.lineId],
    queryFn: ({ signal }) =>
      inboxApi.list(
        workspaceId,
        { view: 'all', status: 'ALL', contactId: chat.contactId, lineId: funnel.lineId },
        undefined,
        signal,
      ),
    enabled: chat.conversationId === undefined && has('messages.read'),
  })
  const conversationId =
    chat.conversationId === undefined ? (found.data?.items[0]?.id ?? null) : chat.conversationId
  const { query } = useContactFunnels(workspaceId, chat.contactId, funnel.lineId)
  const lead = query.data?.find((item) => item.funnelId === funnel.id)?.lead ?? null
  const refresh = () => client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) })
  const onError = (error: unknown) => {
    enqueueSnackbar(errorMessage(error), { variant: 'error' })
    if (error instanceof ApiError && error.body?.code === 'LEAD_CHANGED') void refresh()
  }
  const amount = useMutation({
    mutationFn: (cents: number) =>
      funnelsApi.setAmount(workspaceId, funnel.id, lead?.id ?? '', cents, lead?.version),
    onSuccess: () => enqueueSnackbar(t.valueSaved, { variant: 'success' }),
    onError,
    onSettled: refresh,
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      funnelsApi.archiveLead(workspaceId, funnel.id, lead?.id ?? '', archived),
    onError,
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: () => funnelsApi.removeLead(workspaceId, funnel.id, lead?.id ?? ''),
    onSuccess: () => {
      setConfirmRemove(false)
      onClose()
    },
    onError,
    onSettled: refresh,
  })

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      aria-labelledby="lead-chat-title"
      slotProps={{ paper: { sx: { height: { xs: '100%', sm: '85vh' }, m: { xs: 0, sm: 4 } } } }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography
          id="lead-chat-title"
          variant="subtitle1"
          sx={{ fontWeight: 700, flex: 1 }}
          noWrap
        >
          {t.title(chat.name)}
        </Typography>
        <IconButton aria-label={t.close} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        useFlexGap
        sx={{ px: 2, py: 1.5, alignItems: { md: 'center' }, flexWrap: 'wrap' }}
      >
        <ContactFunnels
          workspaceId={workspaceId}
          contactId={chat.contactId}
          lineId={funnel.lineId}
          direction="row"
        />
        {lead && (
          <AmountField
            key={`${lead.id}:${lead.version}`}
            cents={lead.amountCents}
            disabled={!canWrite || amount.isPending}
            onSave={(cents) => amount.mutate(cents)}
          />
        )}
        {lead && canWrite && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!lead.archivedAt)}
            >
              {lead.archivedAt ? es.funnels.lead.restore : es.funnels.lead.archive}
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={() => setConfirmRemove(true)}
            >
              {es.funnels.lead.remove}
            </Button>
          </Stack>
        )}
      </Stack>
      <Divider />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {chat.visible === false ? (
          <Alert severity="info" sx={{ m: 2, alignSelf: 'flex-start' }}>
            {t.hiddenChat}
          </Alert>
        ) : conversationId ? (
          <ConversationPanel
            workspaceId={workspaceId}
            id={conversationId}
            onBack={onClose}
            detailsOpen={false}
            onDetailsChange={() => {}}
          />
        ) : found.isLoading ? (
          <CircularProgress size={24} sx={{ m: 3 }} />
        ) : (
          <Alert severity="info" sx={{ m: 2, alignSelf: 'flex-start' }}>
            {t.noChat}
          </Alert>
        )}
      </Box>
      <ConfirmDialog
        open={confirmRemove}
        title={es.funnels.lead.remove}
        confirmLabel={es.funnels.lead.remove}
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmRemove(false)}
      >
        {es.funnels.lead.removeBody(chat.name)}
      </ConfirmDialog>
    </Dialog>
  )
}

/** «Valor» in $: saved on Enter or when leaving the field. */
function AmountField({
  cents,
  disabled,
  onSave,
}: {
  cents: number
  disabled: boolean
  onSave: (cents: number) => void
}) {
  const [text, setText] = useState(moneyInput(cents))
  const parsed = parseMoney(text)
  const invalid = parsed !== null && Number.isNaN(parsed)
  const save = () => {
    const value = parsed ?? 0
    if (!invalid && value !== cents) onSave(value)
  }
  return (
    <TextField
      size="small"
      label={`${es.funnels.lead.value} ($)`}
      value={text}
      disabled={disabled}
      error={invalid}
      helperText={es.funnels.lead.valueHelp}
      onChange={(event) => setText(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save()
      }}
      sx={{ width: 170 }}
      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
    />
  )
}
