import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSnackbar } from 'notistack'
import { Can } from '../../auth/permissions'
import { usePermissions } from '../../auth/usePermissions'
import { ApiError, errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys, type ChatMessage } from '../../lib/api/inbox'
import { ContactPanel } from './ContactPanel'

const delivery = {
  received: 'Recibido',
  pending: 'Enviando…',
  sent: '✓ Enviado',
  delivered: '✓✓ Entregado',
  read: '✓✓ Leído',
  failed: 'Error de envío',
}

export function ConversationPanel({
  workspaceId,
  id,
  onBack,
}: {
  workspaceId: string
  id: string
  onBack: () => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [text, setText] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const { has } = usePermissions()
  const current = useQuery({
    queryKey: inboxKeys.conversation(workspaceId, id),
    queryFn: ({ signal }) => inboxApi.get(workspaceId, id, signal),
    refetchInterval: 30_000,
    retry: false,
  })
  const conversation = current.data
  const messages = useInfiniteQuery({
    queryKey: inboxKeys.messages(workspaceId, id),
    queryFn: ({ pageParam, signal }) => inboxApi.messages(workspaceId, id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!conversation && !current.error,
    retry: false,
  })
  const options = useQuery({
    queryKey: inboxKeys.options(workspaceId),
    queryFn: ({ signal }) => inboxApi.options(workspaceId, signal),
  })
  const refresh = () => client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
  const fail = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })
  const action = useMutation({
    mutationFn: ({
      name,
      membershipId,
    }: {
      name: 'take' | 'close' | 'reopen' | 'assign'
      membershipId?: string | null
    }) => inboxApi.action(workspaceId, id, name, membershipId),
    onSuccess: () => {
      void refresh()
    },
    onError: fail,
  })
  const send = useMutation({
    mutationFn: () => inboxApi.send(workspaceId, id, text.trim(), mode === 'note'),
    onSuccess: (message) => {
      setText('')
      if (message.status === 'failed')
        enqueueSnackbar(
          'No se pudo enviar. Revisa el estado del mensaje antes de intentar nuevamente.',
          { variant: 'error' },
        )
      void refresh()
    },
    onError: fail,
    retry: false,
  })
  useEffect(() => {
    if (!conversation?.unreadCount || current.error) return
    let active = true
    void inboxApi
      .action(workspaceId, id, 'read')
      .then(() => {
        if (active) void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      })
      .catch((error: unknown) => {
        if (active) enqueueSnackbar(errorMessage(error), { variant: 'error' })
      })
    return () => {
      active = false
    }
  }, [workspaceId, id, conversation?.unreadCount, current.error, client, enqueueSnackbar])

  const history = [
    ...new Map(
      messages.data?.pages.flatMap((page) => page.items).map((message) => [message.id, message]),
    ).values(),
  ].reverse()
  const end = useRef<HTMLDivElement>(null)
  const newest = messages.data?.pages[0]?.items[0]?.id
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [newest])
  if (current.error)
    return (
      <Alert severity="warning" action={<Button onClick={onBack}>Volver</Button>}>
        {current.error instanceof ApiError && [403, 404].includes(current.error.status)
          ? 'Esta conversación ya no está disponible para ti.'
          : errorMessage(current.error)}
      </Alert>
    )
  if (!conversation) return <LinearProgress />
  const windowClosed =
    !conversation.windowExpiresAt || Date.parse(conversation.windowExpiresAt) <= now
  const blocked = mode === 'reply' && (windowClosed || conversation.status === 'CLOSED')
  const effectiveAssignee = options.data?.members.some(
    (member) => member.membershipId === conversation.assignee?.membershipId,
  )
    ? conversation.assignee?.membershipId
    : ''
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 250px' },
        gap: 2,
        minWidth: 0,
      }}
    >
      <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Stack spacing={1} sx={{ p: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="h6">
                {conversation.contact.name ?? conversation.contact.phone}
              </Typography>
              <Typography variant="caption">
                {conversation.contact.phone} · {conversation.lineName ?? 'Línea eliminada'}
              </Typography>
            </Box>
            <Button onClick={onBack}>Volver</Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={conversation.status === 'OPEN' ? 'Abierto' : 'Cerrado'} />
            <Chip size="small" label={conversation.assignee?.name ?? 'Sin asignar'} />
            <Can anyOf={['messages.send']}>
              {!conversation.assignee && (
                <Button
                  size="small"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ name: 'take' })}
                >
                  Tomar chat
                </Button>
              )}
              <Button
                size="small"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ name: conversation.status === 'OPEN' ? 'close' : 'reopen' })
                }
              >
                {conversation.status === 'OPEN' ? 'Cerrar chat' : 'Reabrir chat'}
              </Button>
            </Can>
          </Stack>
          <Can anyOf={['conversations.assign']}>
            <TextField
              select
              size="small"
              label="Asignar conversación"
              value={effectiveAssignee ?? ''}
              disabled={action.isPending || options.isPending}
              onChange={(event) =>
                action.mutate({ name: 'assign', membershipId: event.target.value || null })
              }
            >
              <MenuItem value="">Sin asignar</MenuItem>
              {options.data?.members.map((member) => (
                <MenuItem key={member.membershipId} value={member.membershipId}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          </Can>
        </Stack>
        <Divider />
        <Stack
          spacing={1.5}
          sx={{ flex: 1, height: '50vh', overflowY: 'auto', p: 2, bgcolor: 'background.default' }}
          aria-label="Historial de mensajes"
        >
          {messages.hasNextPage && (
            <Button
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              Mensajes anteriores
            </Button>
          )}
          {messages.isPending && <LinearProgress />}
          {messages.error && <Alert severity="error">{errorMessage(messages.error)}</Alert>}
          {!messages.isPending && !messages.error && history.length === 0 && (
            <Typography color="text.secondary">Aún no hay mensajes.</Typography>
          )}
          {history.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={end} />
        </Stack>
        {has('messages.send') ? (
          <Stack
            component="form"
            spacing={1.5}
            sx={{ p: 2 }}
            onSubmit={(event) => {
              event.preventDefault()
              if (text.trim() && !blocked && !send.isPending) send.mutate()
            }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_, value: 'reply' | 'note' | null) => {
                if (value) setMode(value)
              }}
            >
              <ToggleButton value="reply">Responder</ToggleButton>
              <ToggleButton value="note">Nota interna</ToggleButton>
            </ToggleButtonGroup>
            {mode === 'note' && (
              <Alert severity="info">Solo tu equipo verá esta nota. No se envía a WhatsApp.</Alert>
            )}
            {blocked && (
              <Alert severity="warning">
                {conversation.status === 'CLOSED'
                  ? 'Reabre el chat para responder.'
                  : 'La ventana de 24 horas terminó. Espera un nuevo mensaje del cliente para responder.'}
              </Alert>
            )}
            <TextField
              multiline
              minRows={2}
              maxRows={5}
              label={mode === 'note' ? 'Escribir nota interna' : 'Escribir respuesta'}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={blocked || send.isPending}
              slotProps={{ htmlInput: { maxLength: 4096 } }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={blocked || !text.trim() || send.isPending}
            >
              {send.isPending
                ? 'Guardando…'
                : mode === 'note'
                  ? 'Guardar nota'
                  : 'Enviar respuesta'}
            </Button>
          </Stack>
        ) : (
          <Alert severity="info">Solo tienes permiso para consultar mensajes.</Alert>
        )}
      </Paper>
      <ContactPanel workspaceId={workspaceId} conversation={conversation} />
    </Box>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <Box
      sx={{
        alignSelf: message.direction === 'IN' ? 'flex-start' : 'flex-end',
        maxWidth: '90%',
        p: 1.5,
        borderRadius: 2,
        bgcolor:
          message.direction === 'NOTE'
            ? 'warning.light'
            : message.direction === 'OUT'
              ? 'primary.main'
              : 'background.paper',
        color:
          message.direction === 'NOTE'
            ? 'warning.contrastText'
            : message.direction === 'OUT'
              ? 'primary.contrastText'
              : 'text.primary',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption">
        {message.direction === 'NOTE' ? 'Nota interna · ' : ''}
        {message.sentBy?.name ?? 'Cliente'}
      </Typography>
      {message.type !== 'text' && (
        <Typography variant="body2">
          Archivo recibido: {message.media?.filename ?? message.type}
          {message.media?.mimeType ? ` (${message.media.mimeType})` : ''}
        </Typography>
      )}
      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {message.text ?? message.media?.caption}
      </Typography>
      <Typography variant="caption" component="div">
        {new Date(message.createdAt).toLocaleString('es-BO')} ·{' '}
        {message.direction === 'NOTE' ? 'Guardada' : delivery[message.status]}
      </Typography>
      {message.status === 'failed' && (
        <Typography variant="body2">
          No entregado: {message.error ?? 'No se pudo enviar el mensaje.'}
        </Typography>
      )}
    </Box>
  )
}
