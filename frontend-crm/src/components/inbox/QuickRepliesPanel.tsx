import AddRounded from '@mui/icons-material/AddRounded'
import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import CancelRounded from '@mui/icons-material/CancelRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditRounded from '@mui/icons-material/EditRounded'
import InsertEmoticonRounded from '@mui/icons-material/InsertEmoticonRounded'
import RateReviewOutlined from '@mui/icons-material/RateReviewOutlined'
import SearchRounded from '@mui/icons-material/SearchRounded'
import SendRounded from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Popover,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { lazy, Suspense, useRef, useState } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { ConfirmDialog } from '../ConfirmDialog'
import { ApiError, errorMessage } from '../../lib/api/errors'
import { inboxKeys } from '../../lib/api/inbox'
import {
  MAX_QUICK_REPLY_ATTACHMENTS,
  matchesQuickReply,
  quickRepliesApi,
  quickReplyKeys,
  type QuickReply,
  type QuickReplyAttachment,
} from '../../lib/api/quick-replies'
import { useChatColors } from './chat-colors'
import { formatBytes } from './media-url'
import { ACCEPT_DOCUMENT, ACCEPT_VISUAL, fileProblem } from './outgoing-media'

const EmojiPanel = lazy(() => import('./EmojiPanel'))

/**
 * Quick replies over the chat, as in wasapi: search by title or content,
 * send one (text and files) or use its text in the message; who manages
 * them also creates, edits and deletes them here.
 */
export function QuickRepliesPanel({
  workspaceId,
  conversationId,
  sendBlockedReason,
  sign,
  onUse,
  onClose,
}: {
  workspaceId: string
  conversationId: string
  /** Why WhatsApp messages cannot go out now (closed chat, 24 h window). */
  sendBlockedReason: string | null
  sign: boolean
  /** Puts the text in the composer. */
  onUse: (text: string) => void
  onClose: () => void
}) {
  const { has } = usePermissions()
  const manage = has('quick_replies.manage')
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<QuickReply | 'new' | null>(null)
  const [deleting, setDeleting] = useState<QuickReply | null>(null)
  const replies = useQuery({
    queryKey: quickReplyKeys.all(workspaceId),
    queryFn: ({ signal }) => quickRepliesApi.list(workspaceId, signal),
  })
  const send = useMutation({
    mutationFn: (reply: QuickReply) =>
      quickRepliesApi.send(workspaceId, conversationId, reply.id, sign),
    onSuccess: () => onClose(),
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) }),
  })
  const remove = useMutation({
    mutationFn: (reply: QuickReply) => quickRepliesApi.remove(workspaceId, reply.id),
    onSuccess: () => {
      setDeleting(null)
      enqueueSnackbar('Respuesta rápida eliminada.', { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
    onSettled: () => client.invalidateQueries({ queryKey: quickReplyKeys.all(workspaceId) }),
  })
  const found = (replies.data ?? []).filter((reply) => matchesQuickReply(reply, search))

  return (
    <Paper
      square
      elevation={8}
      role="dialog"
      aria-label={editing ? 'Edición de respuesta rápida' : 'Respuestas rápidas'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !editing) onClose()
      }}
      sx={{
        position: 'absolute',
        inset: 0,
        right: 'auto',
        width: { xs: '100%', md: 'min(100%, 760px)' },
        zIndex: 3,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <IconButton
          aria-label={editing ? 'Volver a las respuestas rápidas' : 'Cerrar respuestas rápidas'}
          onClick={() => (editing ? setEditing(null) : onClose())}
        >
          <CloseRounded />
        </IconButton>
        <Typography variant="h6" component="h2">
          {editing ? 'Edición de respuesta rápida' : 'Respuestas rápidas'}
        </Typography>
      </Stack>
      {editing ? (
        <QuickReplyEditor
          key={editing === 'new' ? 'new' : editing.id}
          workspaceId={workspaceId}
          reply={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, pb: 1.5 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Buscar respuesta rápida"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              slotProps={{
                htmlInput: { 'aria-label': 'Buscar respuesta rápida' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {manage && (
              <Tooltip title="Nueva respuesta rápida">
                <IconButton aria-label="Nueva respuesta rápida" onClick={() => setEditing('new')}>
                  <AddRounded />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          {sendBlockedReason && (
            <Alert severity="warning" sx={{ mx: 2, mb: 1, py: 0 }}>
              {sendBlockedReason}
            </Alert>
          )}
          <Stack spacing={1.5} sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2 }}>
            {replies.isPending &&
              [0, 1, 2].map((key) => <Skeleton key={key} variant="rounded" height={96} />)}
            {replies.error && <Alert severity="error">{errorMessage(replies.error)}</Alert>}
            {replies.data && found.length === 0 && (
              <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                {replies.data.length === 0
                  ? manage
                    ? 'Aún no hay respuestas rápidas. Crea la primera con «+».'
                    : 'Aún no hay respuestas rápidas.'
                  : 'Ninguna respuesta rápida coincide con la búsqueda.'}
              </Typography>
            )}
            {found.map((reply) => (
              <QuickReplyCard
                key={reply.id}
                reply={reply}
                manage={manage}
                sending={send.isPending && send.variables.id === reply.id}
                sendDisabled={!!sendBlockedReason || send.isPending}
                onSend={() => send.mutate(reply)}
                onUse={() => {
                  onUse(reply.text)
                  onClose()
                }}
                onEdit={() => setEditing(reply)}
                onDelete={() => setDeleting(reply)}
              />
            ))}
          </Stack>
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Eliminar respuesta rápida"
        confirmLabel="Eliminar"
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        Se eliminará «{deleting?.title}» para todo el equipo.
      </ConfirmDialog>
    </Paper>
  )
}

function QuickReplyCard({
  reply,
  manage,
  sending,
  sendDisabled,
  onSend,
  onUse,
  onEdit,
  onDelete,
}: {
  reply: QuickReply
  manage: boolean
  sending: boolean
  sendDisabled: boolean
  onSend: () => void
  onUse: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const colors = useChatColors()
  return (
    <Paper
      variant="outlined"
      component="article"
      aria-label={reply.title}
      sx={{ p: 2, borderRadius: 2 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography sx={{ fontWeight: 700, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          {reply.title}
        </Typography>
        <Tooltip title="Usar el texto en el mensaje">
          <IconButton
            aria-label={`Usar «${reply.title}» en el mensaje`}
            onClick={onUse}
            sx={{ bgcolor: 'action.hover' }}
          >
            <RateReviewOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={reply.attachments.length ? 'Enviar el texto y los archivos' : 'Enviar'}>
          <span>
            <IconButton
              aria-label={`Enviar «${reply.title}»`}
              onClick={onSend}
              disabled={sendDisabled}
              sx={{
                bgcolor: colors.unread,
                color: '#fff',
                '&:hover': { bgcolor: colors.unread, filter: 'brightness(0.92)' },
              }}
            >
              {sending ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <SendRounded fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 1 }}
      >
        {reply.text}
      </Typography>
      {reply.attachments.length > 0 && (
        <AttachmentChips attachments={reply.attachments} sx={{ mt: 1 }} />
      )}
      {manage && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1 }}>
          <IconButton size="small" aria-label={`Editar «${reply.title}»`} onClick={onEdit}>
            <EditRounded fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={`Eliminar «${reply.title}»`} onClick={onDelete}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Stack>
      )}
    </Paper>
  )
}

function AttachmentChips({
  attachments,
  onRemove,
  sx,
}: {
  attachments: QuickReplyAttachment[]
  onRemove?: (attachment: QuickReplyAttachment) => void
  sx?: object
}) {
  return (
    <Stack spacing={0.75} sx={{ alignItems: 'flex-start', ...sx }}>
      {attachments.map((attachment) => (
        <Chip
          key={attachment.fileId}
          size="small"
          label={`${attachment.filename} (${formatBytes(attachment.size)})`}
          onDelete={onRemove ? () => onRemove(attachment) : undefined}
          deleteIcon={<CancelRounded aria-label={`Quitar ${attachment.filename}`} />}
          sx={{ maxWidth: '100%' }}
        />
      ))}
    </Stack>
  )
}

function QuickReplyEditor({
  workspaceId,
  reply,
  onDone,
}: {
  workspaceId: string
  reply: QuickReply | null
  onDone: () => void
}) {
  const colors = useChatColors()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [title, setTitle] = useState(reply?.title ?? '')
  const [text, setText] = useState(reply?.text ?? '')
  const [attachments, setAttachments] = useState<QuickReplyAttachment[]>(reply?.attachments ?? [])
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  const [titleTaken, setTitleTaken] = useState(false)
  const content = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: (file: File) => quickRepliesApi.upload(workspaceId, file),
    onSuccess: (attachment) => setAttachments((current) => [...current, attachment]),
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        text: text.trim(),
        attachmentIds: attachments.map((attachment) => attachment.fileId),
      }
      return reply
        ? quickRepliesApi.update(workspaceId, reply.id, body)
        : quickRepliesApi.create(workspaceId, body)
    },
    onSuccess: () => {
      enqueueSnackbar(reply ? 'Respuesta rápida actualizada.' : 'Respuesta rápida creada.', {
        variant: 'success',
      })
      void client.invalidateQueries({ queryKey: quickReplyKeys.all(workspaceId) })
      onDone()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.body?.code === 'QUICK_REPLY_SHORTCUT_TAKEN') {
        setTitleTaken(true)
        return
      }
      enqueueSnackbar(errorMessage(error), { variant: 'error' })
    },
  })
  const insertEmoji = (emoji: string) => {
    const element = content.current
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }
  const full = attachments.length >= MAX_QUICK_REPLY_ATTACHMENTS
  const valid = !!title.trim() && !!text.trim() && !upload.isPending
  const busy = save.isPending

  return (
    <>
      <Stack spacing={2} sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2, pt: 0.5 }}>
        <TextField
          label="Título"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setTitleTaken(false)
          }}
          error={titleTaken}
          helperText={titleTaken ? 'Ya existe una respuesta rápida con ese título.' : undefined}
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
        <TextField
          label="Contenido"
          multiline
          minRows={4}
          value={text}
          inputRef={content}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          slotProps={{
            htmlInput: { maxLength: 4096 },
            input: {
              startAdornment: (
                <InputAdornment position="start" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                  <IconButton
                    size="small"
                    aria-label="Emojis"
                    onClick={(event) => setEmojiAnchor(event.currentTarget)}
                  >
                    <InsertEmoticonRounded />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Popover
          open={!!emojiAnchor}
          anchorEl={emojiAnchor}
          onClose={() => setEmojiAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Suspense
            fallback={
              <Box sx={{ width: 320, height: 380, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={28} />
              </Box>
            }
          >
            <EmojiPanel dark={colors.dark} onPick={insertEmoji} />
          </Suspense>
        </Popover>
        <Box
          component="fieldset"
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, pb: 1.5, m: 0 }}
        >
          <Typography component="legend" variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            (Opcional) Adjuntar archivos
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Tooltip
              title={
                full
                  ? `Hasta ${MAX_QUICK_REPLY_ATTACHMENTS} archivos`
                  : 'Adjuntar archivo (imagen, video o documento)'
              }
            >
              <span>
                <IconButton
                  aria-label="Adjuntar archivo"
                  disabled={full || busy || upload.isPending}
                  onClick={() => picker.current?.click()}
                >
                  {upload.isPending ? <CircularProgress size={20} /> : <AttachFileRounded />}
                </IconButton>
              </span>
            </Tooltip>
            <input
              ref={picker}
              type="file"
              hidden
              accept={`${ACCEPT_VISUAL},${ACCEPT_DOCUMENT}`}
              aria-label="Elegir archivo para adjuntar"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const problem = fileProblem(file)
                if (problem) enqueueSnackbar(problem, { variant: 'warning' })
                else upload.mutate(file)
              }}
            />
            {attachments.length > 0 ? (
              <AttachmentChips
                attachments={attachments}
                onRemove={(removed) =>
                  setAttachments((current) =>
                    current.filter((attachment) => attachment.fileId !== removed.fileId),
                  )
                }
                sx={{ pt: 1, minWidth: 0 }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ pt: 1.25 }}>
                Se envían después del texto.
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'flex-end', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        <Button variant="outlined" onClick={onDone} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={() => save.mutate()}
          disabled={!valid || busy}
        >
          Guardar
        </Button>
      </Stack>
    </>
  )
}
