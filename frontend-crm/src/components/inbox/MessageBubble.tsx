import DoneAllRounded from '@mui/icons-material/DoneAllRounded'
import DoneRounded from '@mui/icons-material/DoneRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import ScheduleRounded from '@mui/icons-material/ScheduleRounded'
import { Box, Stack, Typography } from '@mui/material'
import type { ChatMessage } from '../../lib/api/inbox'
import { useChatColors, type ChatColors } from './chat-colors'
import { DELIVERY_LABELS, eventText, messageTime } from './inbox-format'
import { MessageContent } from './MessageContent'

/** "Hoy", "Ayer" or the date, centered between the messages of each day. */
export function DaySeparator({ label }: { label: string }) {
  const colors = useChatColors()
  return (
    <Box sx={{ alignSelf: 'center', my: 1 }}>
      <Typography
        variant="caption"
        sx={{
          px: 1.5,
          py: 0.5,
          borderRadius: 2,
          bgcolor: colors.notice,
          color: colors.noticeText,
          boxShadow: 1,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {label}
      </Typography>
    </Box>
  )
}

/** A movement of the conversation (assigned, transferred, closed…), centered like a system notice. */
export function EventNotice({ message }: { message: ChatMessage }) {
  const colors = useChatColors()
  if (!message.event) return null
  return (
    <Box sx={{ alignSelf: 'center', maxWidth: '85%', my: 0.5 }} role="note">
      <Typography
        variant="caption"
        component="div"
        sx={{
          px: 1.5,
          py: 0.5,
          borderRadius: 2,
          bgcolor: colors.notice,
          color: colors.noticeText,
          boxShadow: 1,
          textAlign: 'center',
        }}
      >
        {eventText(message.event)} · {messageTime(message.createdAt)}
      </Typography>
    </Box>
  )
}

function DeliveryIcon({ message, colors }: { message: ChatMessage; colors: ChatColors }) {
  const label = DELIVERY_LABELS[message.status]
  const sx = { fontSize: 16 }
  switch (message.status) {
    case 'pending':
      return <ScheduleRounded aria-label={label} sx={sx} />
    case 'sent':
      return <DoneRounded aria-label={label} sx={sx} />
    case 'delivered':
      return <DoneAllRounded aria-label={label} sx={sx} />
    case 'read':
      return <DoneAllRounded aria-label={label} sx={{ ...sx, color: colors.read }} />
    case 'failed':
      return <ErrorOutlineRounded aria-label={label} color="error" sx={sx} />
    default:
      return null
  }
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const colors = useChatColors()
  if (message.direction === 'EVENT') return <EventNotice message={message} />
  const incoming = message.direction === 'IN'
  const note = message.direction === 'NOTE'
  // Stickers float without a bubble, as in WhatsApp.
  const bare = message.type === 'sticker'
  return (
    <Box
      sx={{
        alignSelf: incoming ? 'flex-start' : 'flex-end',
        maxWidth: { xs: '88%', md: '65%' },
        px: bare ? 0 : 1,
        pt: bare ? 0 : 0.75,
        pb: bare ? 0 : 0.5,
        borderRadius: 2,
        borderTopLeftRadius: incoming ? 0 : 8,
        borderTopRightRadius: incoming ? 8 : 0,
        bgcolor: bare
          ? 'transparent'
          : note
            ? colors.note
            : incoming
              ? colors.incoming
              : colors.outgoing,
        boxShadow: bare ? 0 : '0 1px 0.5px rgba(11,20,26,0.13)',
        color: 'text.primary',
      }}
    >
      {!incoming && (
        <Typography
          variant="caption"
          component="div"
          sx={{ fontWeight: 600, color: note ? 'warning.main' : colors.agent }}
        >
          {note ? `Nota interna · ${message.sentBy?.name ?? ''}` : (message.sentBy?.name ?? '')}
        </Typography>
      )}
      <MessageContent message={message} />
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ justifyContent: 'flex-end', alignItems: 'center', color: colors.meta, mt: 0.25 }}
      >
        <Typography variant="caption" sx={{ fontSize: 11 }}>
          {messageTime(message.createdAt)}
        </Typography>
        {message.direction === 'OUT' && <DeliveryIcon message={message} colors={colors} />}
      </Stack>
      {message.status === 'failed' && (
        <Typography variant="caption" color="error" component="div">
          No entregado: {message.error ?? 'No se pudo enviar el mensaje.'}
        </Typography>
      )}
    </Box>
  )
}
