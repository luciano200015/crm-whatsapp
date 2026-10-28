import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
import { useMe } from '../../auth/useMe'
import { usePermissions } from '../../auth/usePermissions'
import { useChatSettings } from '../../lib/api/chat-settings'
import { ApiError, errorMessage } from '../../lib/api/errors'
import BlockRounded from '@mui/icons-material/BlockRounded'
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { inboxApi, inboxKeys } from '../../lib/api/inbox'
import { BlockContactDialog, type BlockTarget } from '../contacts/BlockContactDialog'
import { botChoices, BOT_CHOICES } from './bot-pause'
import { ChatHeader, type ChatAction } from './ChatHeader'
import { ChatTagChips, ChatTagPopover } from './ChatTags'
import { useCanTagChat } from './useCanTagChat'
import { useChatColors } from './chat-colors'
import { Composer, type ComposerHandle, type ComposerMode } from './Composer'
import { QuickRepliesPanel } from './QuickRepliesPanel'
import { useSignPreference } from './sign-preference'
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
      chosen.name === 'close'
        ? inboxApi.close(workspaceId, id, chosen.sendMessage ?? false)
        : inboxApi.action(
            workspaceId,
            id,
            chosen.name,
            chosen.name === 'assign' ? chosen.membershipId : undefined,
          ),
    onSuccess: (result, chosen) => {
      if (chosen.name === 'unread') {
        enqueueSnackbar('Chat marcado como no leído', { variant: 'info' })
        onBack()
      }
      if ('closeMessageError' in result && result.closeMessageError) {
        enqueueSnackbar(
          result.closeMessageError === 'WINDOW_CLOSED'
            ? 'El chat se cerró, pero el mensaje de cierre no se envió: la ventana de 24 horas terminó.'
            : 'El chat se cerró, pero WhatsApp no aceptó el mensaje de cierre.',
          { variant: 'warning' },
        )
      }
      void refresh()
    },
    onError: fail,
  })
  const settings = useChatSettings(workspaceId)
  const meId = useMe().data?.id
  const [sign, setSign] = useSignPreference()
  const [quickReplies, setQuickReplies] = useState(false)
  const [askClose, setAskClose] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const closeMessage = settings.data?.closeMessage
  const runAction = (chosen: ChatAction) => {
    // «Preguntar para enviar»: the agent decides before closing.
    if (chosen.name === 'close' && closeMessage?.mode === 'ASK' && closeMessage.text) {
      setAskClose(true)
      return
    }
    action.mutate(chosen)
  }
  const closeWith = (sendMessage: boolean) => {
    setAskClose(false)
    action.mutate({ name: 'close', sendMessage })
  }
  const bot = useMutation({
    mutationFn: (chosen: '24h' | 'permanent' | 'resume') =>
      chosen === 'resume'
        ? inboxApi.bot(workspaceId, id, 'resume')
        : inboxApi.bot(workspaceId, id, 'pause', chosen),
    onSuccess: (_, chosen) => {
      enqueueSnackbar(
        chosen === 'resume'
          ? 'Bot activado: responderá al próximo mensaje del cliente'
          : chosen === '24h'
            ? 'Bot desactivado en este chat por 24 horas'
            : 'Bot desactivado en este chat permanentemente',
        { variant: 'success' },
      )
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
          // «Transferencia de chats»: agents pass on their own chats; admins any.
          canTransfer={
            has('conversations.assign') ||
            (!!options.data?.transfers && conversation.assignee?.userId === meId)
          }
          canUnassign={has('conversations.assign')}
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
          onAction={runAction}
          onBack={onBack}
          detailsOpen={detailsOpen}
          onToggleDetails={() => onDetailsChange(!detailsOpen)}
          blocked={contact.data?.blocked ?? false}
          extraMenuItems={(close) => [
            ...(has('messages.send') && conversation.bot && conversation.bot.state !== 'none'
              ? botChoices(conversation.bot).map((choice) => (
                  <MenuItem
                    key={`bot-${choice}`}
                    disabled={bot.isPending}
                    onClick={() => {
                      close()
                      bot.mutate(choice)
                    }}
                  >
                    <ListItemIcon>
                      <SmartToyOutlined color={choice === 'resume' ? 'primary' : 'warning'} />
                    </ListItemIcon>
                    <ListItemText>{BOT_CHOICES[choice]}</ListItemText>
                  </MenuItem>
                ))
              : []),
            has('contacts.write') && contact.data && (
              <MenuItem
                key="block"
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
            ),
          ]}
        />
        <BlockContactDialog
          workspaceId={workspaceId}
          contact={blockTarget}
          onClose={() => setBlockTarget(null)}
        />
        <Dialog open={askClose} onClose={() => setAskClose(false)} maxWidth="xs" fullWidth>
          <DialogTitle>¿Enviar el mensaje de cierre?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ whiteSpace: 'pre-wrap' }}>
              {closeMessage?.text}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => closeWith(false)}>Cerrar sin enviar</Button>
            <Button variant="contained" color="success" onClick={() => closeWith(true)}>
              Enviar y cerrar
            </Button>
          </DialogActions>
        </Dialog>
        <Box
          sx={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {quickReplies && (
            <QuickRepliesPanel
              workspaceId={workspaceId}
              conversationId={id}
              sendBlockedReason={replyBlockedReason}
              sign={settings.data?.signature === 'AGENT_CHOICE' && sign}
              onUse={(text) => composer.current?.useText(text)}
              onClose={() => setQuickReplies(false)}
            />
          )}
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
              ref={composer}
              replyBlockedReason={replyBlockedReason}
              onOpenQuickReplies={() => setQuickReplies(true)}
              signature={settings.data?.signature}
              sign={sign}
              onSignChange={setSign}
              onSend={(text, mode: ComposerMode) => {
                queue.send({
                  kind: 'text',
                  text,
                  note: mode === 'note',
                  sign: mode === 'reply' && settings.data?.signature === 'AGENT_CHOICE' && sign,
                })
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
