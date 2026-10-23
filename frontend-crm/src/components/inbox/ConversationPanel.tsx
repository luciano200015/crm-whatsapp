import {
  Alert,
  Box,
  Button,
  Drawer,
  LinearProgress,
  Stack,
  Typography,
  useMediaQuery,
  ListItemIcon,
  ListItemText,
  MenuItem,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWhenVisible } from '../../hooks/useWhenVisible'
import { usePermissions } from '../../auth/usePermissions'
import { ApiError, errorMessage } from '../../lib/api/errors'
import BlockRounded from '@mui/icons-material/BlockRounded'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
import { BlockContactDialog, type BlockTarget } from '../contacts/BlockContactDialog'
import { ChatHeader, type ChatAction } from './ChatHeader'
import { ChatTagChips, ChatTagPopover } from './ChatTags'
import { useCanTagChat } from './useCanTagChat'
import { useChatColors } from './chat-colors'
import { Composer, type ComposerMode } from './Composer'
import { ContactPanel } from './ContactPanel'
import { contactName, dayLabel, sameDay } from './inbox-format'
import { DaySeparator, MessageBubble } from './MessageBubble'
import { useSendQueue } from './useSendQueue'

export function ConversationPanel({
  workspaceId,
  id,
  onBack,
  detailsOpen,
  onDetailsChange,
}: {
  workspaceId: string
  id: string
  onBack: () => void
  /** The details panel (contact) is showing; hidden until asked for. */
  detailsOpen: boolean
  onDetailsChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { has } = usePermissions()
  const colors = useChatColors()
  const canTag = useCanTagChat()
  // Details panel: beside the chat on wide screens, as a drawer otherwise.
  const wide = useMediaQuery(useTheme().breakpoints.up('lg'))
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
  // Same query as the contact panel: tells whether the contact is blocked.
  const contactId = current.data?.contactId ?? ''
  const contact = useQuery({
    queryKey: [...contactKeys.all(workspaceId), 'detail', contactId],
    queryFn: ({ signal }) => contactsApi.get(workspaceId, contactId, signal),
    enabled: !!contactId && has('contacts.read'),
  })
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null)
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
  const queue = useSendQueue(workspaceId, id)

  const retry = useMutation({
    mutationFn: (messageId: string) => inboxApi.retry(workspaceId, id, messageId),
    onSuccess: (message) => {
      enqueueSnackbar(
        message.status === 'failed' ? 'WhatsApp volvió a rechazar el mensaje.' : 'Mensaje enviado.',
        { variant: message.status === 'failed' ? 'error' : 'success' },
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

  const stored = [
    ...new Map(
      messages.data?.pages.flatMap((page) => page.items).map((message) => [message.id, message]),
    ).values(),
  ].reverse()
  // Messages still on their way go last; once the server has one (same
  // clientId), its own bubble takes over.
  const arrived = new Set(stored.map((message) => message.clientId).filter(Boolean))
  const pending = queue.pending.filter((message) => !arrived.has(message.clientId))
  const history = [...stored, ...pending]
  const end = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const newest = messages.data?.pages[0]?.items[0]?.id
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [newest, pending.length])
  // Only the latest messages load first; older ones come when scrolling up
  // (like WhatsApp), keeping the view where it was.
  const keepPosition = useRef<{ height: number; top: number } | null>(null)
  const older = useWhenVisible<HTMLDivElement>(() => {
    const element = scroller.current
    if (!messages.hasNextPage || messages.isFetchingNextPage || !element) return
    keepPosition.current = { height: element.scrollHeight, top: element.scrollTop }
    void messages.fetchNextPage()
  }, !!messages.hasNextPage)
  const pages = messages.data?.pages.length ?? 0
  useLayoutEffect(() => {
    const element = scroller.current
    const before = keepPosition.current
    if (!element || !before || messages.isFetchingNextPage) return
    element.scrollTop = element.scrollHeight - before.height + before.top
    keepPosition.current = null
  }, [pages, messages.isFetchingNextPage])

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
  const info = (
    <ContactPanel
      workspaceId={workspaceId}
      conversation={conversation}
      onClose={() => onDetailsChange(false)}
    />
  )
  const lineColor = options.data?.lines.find((line) => line.id === conversation.lineId)?.color

  return (
    <Box sx={{ display: 'flex', height: '100%', minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <ChatHeader
          conversation={conversation}
          // Only who attends the line of the chat (or sees every line) can receive it.
          members={(options.data?.members ?? []).filter(
            (member) =>
              member.viewAll !== false || (member.lineIds ?? []).includes(conversation.lineId),
          )}
          tagChips={<ChatTagChips workspaceId={workspaceId} conversation={conversation} />}
          renderTagPopover={
            canTag
              ? (anchorEl, onClose) => (
                  <ChatTagPopover
                    workspaceId={workspaceId}
                    conversation={conversation}
                    anchorEl={anchorEl}
                    onClose={onClose}
                  />
                )
              : undefined
          }
          lineColor={lineColor}
          busy={action.isPending}
          onAction={(chosen) => action.mutate(chosen)}
          onBack={onBack}
          detailsOpen={detailsOpen}
          onToggleDetails={() => onDetailsChange(!detailsOpen)}
          blocked={contact.data?.blocked ?? false}
          extraMenuItems={
            has('contacts.write') && contact.data
              ? (close) => (
                  <MenuItem
                    onClick={() => {
                      close()
                      setBlockTarget({
                        id: conversation.contactId,
                        name: contactName(conversation.contact),
                        blocked: contact.data?.blocked ?? false,
                      })
                    }}
                  >
                    <ListItemIcon>
                      <BlockRounded color="error" />
                    </ListItemIcon>
                    <ListItemText>
                      {contact.data?.blocked ? 'Desbloquear contacto' : 'Bloquear contacto'}
                    </ListItemText>
                  </MenuItem>
                )
              : undefined
          }
        />
        <BlockContactDialog
          workspaceId={workspaceId}
          contact={blockTarget}
          onClose={() => setBlockTarget(null)}
        />
        <Stack
          spacing={0.75}
          ref={scroller}
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
          <Box ref={older} sx={{ minHeight: 1 }} />
          {messages.isFetchingNextPage && (
            <LinearProgress sx={{ alignSelf: 'center', width: 120, borderRadius: 1 }} />
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
                {message.id.startsWith('local-') ? (
                  <MessageBubble
                    message={message}
                    onRetry={() => queue.retry(message.clientId ?? '')}
                    onDiscard={() => queue.discard(message.clientId ?? '')}
                  />
                ) : (
                  <MessageBubble
                    message={message}
                    onRetry={
                      message.direction === 'OUT' &&
                      message.status === 'failed' &&
                      has('messages.send') &&
                      conversation?.status !== 'CLOSED'
                        ? () => retry.mutate(message.id)
                        : undefined
                    }
                    retrying={retry.isPending && retry.variables === message.id}
                  />
                )}
              </Fragment>
            )
          })}
          <div ref={end} />
        </Stack>
        {has('messages.send') ? (
          <Composer
            replyBlockedReason={replyBlockedReason}
            onSend={(text, mode: ComposerMode) => {
              queue.send({ kind: 'text', text, note: mode === 'note' })
              return Promise.resolve(true)
            }}
            onSendFile={(file, caption) => {
              queue.send({ kind: 'media', file, caption })
              return Promise.resolve(true)
            }}
            onSendContacts={(contacts) => {
              queue.send({ kind: 'contacts', contacts })
              return Promise.resolve(true)
            }}
            onError={(message) => enqueueSnackbar(message, { variant: 'warning' })}
          />
        ) : (
          <Alert severity="info" sx={{ borderRadius: 0 }}>
            Solo tienes permiso para consultar mensajes.
          </Alert>
        )}
      </Box>
      {wide ? (
        detailsOpen && (
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
        <Drawer anchor="right" open={detailsOpen} onClose={() => onDetailsChange(false)}>
          <Box sx={{ width: 320 }}>{info}</Box>
        </Drawer>
      )}
    </Box>
  )
}
