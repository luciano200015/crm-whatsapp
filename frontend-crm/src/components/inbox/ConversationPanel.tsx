import {
  Alert,
  Box,
  Button,
  Drawer,
  LinearProgress,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { Fragment, useEffect, useRef, useState } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { ApiError, errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
import { ChatHeader, type ChatAction } from './ChatHeader'
import { useChatColors } from './chat-colors'
import { Composer, type ComposerMode } from './Composer'
import { ContactPanel } from './ContactPanel'
import { dayLabel, sameDay } from './inbox-format'
import { DaySeparator, MessageBubble } from './MessageBubble'

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
  const { has } = usePermissions()
  const colors = useChatColors()
  const wide = useMediaQuery(useTheme().breakpoints.up('lg'))
  // Contact panel: open beside the chat on wide screens, as a drawer otherwise.
  const [infoChoice, setInfoChoice] = useState<boolean | null>(null)
  const showInfo = infoChoice ?? wide
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

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
    mutationFn: (chosen: ChatAction) =>
      inboxApi.action(
        workspaceId,
        id,
        chosen.name,
        chosen.name === 'assign' ? chosen.membershipId : undefined,
      ),
    onSuccess: (_, chosen) => {
      if (chosen.name === 'unread') {
        enqueueSnackbar('Chat marcado como no leído', { variant: 'info' })
        onBack()
      }
      void refresh()
    },
    onError: fail,
  })
  const send = useMutation({
    mutationFn: ({ text, mode }: { text: string; mode: ComposerMode }) =>
      inboxApi.send(workspaceId, id, text, mode === 'note'),
    onSuccess: (message) => {
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

  // Opening a chat reads it (but not right after "Marcar como no leído").
  useEffect(() => {
    if (!conversation?.unreadCount || current.error || action.isPending) return
    if (action.variables?.name === 'unread' && action.isSuccess) return
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
  }, [
    workspaceId,
    id,
    conversation?.unreadCount,
    current.error,
    client,
    enqueueSnackbar,
    action.isPending,
    action.isSuccess,
    action.variables,
  ])

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
      <Box sx={{ p: 2 }}>
        <Alert severity="warning" action={<Button onClick={onBack}>Volver</Button>}>
          {current.error instanceof ApiError && [403, 404].includes(current.error.status)
            ? 'Esta conversación ya no está disponible para ti.'
            : errorMessage(current.error)}
        </Alert>
      </Box>
    )
  if (!conversation) return <LinearProgress />

  const windowClosed =
    !conversation.windowExpiresAt || Date.parse(conversation.windowExpiresAt) <= now
  const replyBlockedReason =
    conversation.status === 'CLOSED'
      ? 'Reabre el chat para responder.'
      : windowClosed
        ? 'La ventana de 24 horas terminó. Espera un nuevo mensaje del cliente para responder.'
        : null
  const info = <ContactPanel workspaceId={workspaceId} conversation={conversation} />

  return (
    <Box sx={{ display: 'flex', height: '100%', minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <ChatHeader
          conversation={conversation}
          members={options.data?.members ?? []}
          busy={action.isPending}
          onAction={(chosen) => action.mutate(chosen)}
          onBack={onBack}
          onToggleInfo={() => setInfoChoice(!showInfo)}
        />
        <Stack
          spacing={0.75}
          aria-label="Historial de mensajes"
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: { xs: 1.5, md: 6 },
            py: 2,
            bgcolor: colors.wallpaper,
            backgroundImage: `radial-gradient(${colors.pattern} 1px, transparent 1px)`,
            backgroundSize: '18px 18px',
          }}
        >
          {messages.hasNextPage && (
            <Button
              size="small"
              sx={{ alignSelf: 'center', bgcolor: 'background.paper' }}
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              Mensajes anteriores
            </Button>
          )}
          {messages.isPending && <LinearProgress />}
          {messages.error && <Alert severity="error">{errorMessage(messages.error)}</Alert>}
          {!messages.isPending && !messages.error && history.length === 0 && (
            <Typography color="text.secondary" sx={{ alignSelf: 'center' }}>
              Aún no hay mensajes.
            </Typography>
          )}
          {history.map((message, index) => {
            const previous = history[index - 1]
            return (
              <Fragment key={message.id}>
                {(!previous || !sameDay(previous.createdAt, message.createdAt)) && (
                  <DaySeparator label={dayLabel(message.createdAt)} />
                )}
                <MessageBubble message={message} />
              </Fragment>
            )
          })}
          <div ref={end} />
        </Stack>
        {has('messages.send') ? (
          <Composer
            replyBlockedReason={replyBlockedReason}
            sending={send.isPending}
            onSend={(text, mode) =>
              send
                .mutateAsync({ text, mode })
                .then(() => true)
                .catch(() => false)
            }
          />
        ) : (
          <Alert severity="info" sx={{ borderRadius: 0 }}>
            Solo tienes permiso para consultar mensajes.
          </Alert>
        )}
      </Box>
      {wide ? (
        showInfo && (
          <Box
            sx={{
              width: 320,
              flexShrink: 0,
              borderLeft: 1,
              borderColor: 'divider',
              overflowY: 'auto',
              bgcolor: 'background.paper',
            }}
          >
            {info}
          </Box>
        )
      ) : (
        <Drawer anchor="right" open={showInfo} onClose={() => setInfoChoice(false)}>
          <Box sx={{ width: 320 }}>{info}</Box>
        </Drawer>
      )}
    </Box>
  )
}
