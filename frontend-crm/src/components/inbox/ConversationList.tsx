import DoneAllRounded from '@mui/icons-material/DoneAllRounded'
import DoneRounded from '@mui/icons-material/DoneRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded'
import ScheduleRounded from '@mui/icons-material/ScheduleRounded'
import WhatsApp from '@mui/icons-material/WhatsApp'
import { Avatar, Badge, Box, Chip, ListItemButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { Conversation } from '../../lib/api/inbox'
import type { TagSummary } from '../../lib/api/types'
import { useChatColors, type ChatColors } from './chat-colors'
import {
  avatarColor,
  contactName,
  initials,
  listTime,
  preview,
  shortName,
  STATUS_LABELS,
} from './inbox-format'

export function ContactAvatar({
  contact,
  size = 48,
  ring,
}: {
  contact: Conversation['contact']
  size?: number
  /** Color of the chat's line, as a ring around the avatar (as in wasapi). */
  ring?: string | null
}) {
  const name = contactName(contact)
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: avatarColor(contact.phone),
        fontSize: size * 0.38,
        fontWeight: 600,
        ...(ring && { outline: `2px solid ${ring}`, outlineOffset: 2 }),
      }}
    >
      {initials(name)}
    </Avatar>
  )
}

/** ✓, ✓✓, blue ✓✓ or ⚠ before the preview when the last message is ours. */
function LastDelivery({
  status,
  colors,
}: {
  status: NonNullable<Conversation['lastMessage']>['status']
  colors: ChatColors
}) {
  const sx = { fontSize: 16, flexShrink: 0 }
  switch (status) {
    case 'pending':
      return <ScheduleRounded aria-label="Enviando" sx={sx} />
    case 'sent':
      return <DoneRounded aria-label="Enviado" sx={sx} />
    case 'delivered':
      return <DoneAllRounded aria-label="Entregado" sx={sx} />
    case 'read':
      return <DoneAllRounded aria-label="Leído" sx={{ ...sx, color: colors.read }} />
    case 'failed':
      return <ErrorOutlineRounded aria-label="No entregado" color="error" sx={sx} />
    default:
      return null
  }
}

/** The line of the chat, as a small WhatsApp badge on the avatar. */
function LineBadge({ lineName, color }: { lineName: string | null; color?: string | null }) {
  return (
    <Box
      aria-label={`Línea ${lineName ?? 'eliminada'}`}
      sx={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        bgcolor: color ?? '#25d366',
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        border: 2,
        borderColor: 'background.paper',
      }}
    >
      <WhatsApp sx={{ fontSize: 12 }} />
    </Box>
  )
}

/**
 * One row of the chat list, as in wasapi: avatar with the line, name, time,
 * preview with ✓✓, unread badge, the contact's tags and who attends it.
 */
export function ConversationListItem({
  conversation,
  selected,
  onSelect,
  meId,
  tags,
  lineColor,
}: {
  conversation: Conversation
  selected: boolean
  onSelect: () => void
  /** The signed-in user: their chats say «Tú». */
  meId?: string
  /** Tags of the workspace by id. */
  tags?: Map<string, TagSummary>
  /** Color of the chat's line: frames the row and rings the avatar, as in wasapi. */
  lineColor?: string | null
}) {
  const colors = useChatColors()
  const unread = conversation.unreadCount > 0
  const last = conversation.lastMessage
  const assignee = conversation.assignee
  const mine = !!assignee && assignee.userId === meId
  const chips = (conversation.contactTagIds ?? [])
    .map((id) => tags?.get(id))
    .filter((tag): tag is TagSummary => !!tag)
  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      aria-label={`Chat con ${contactName(conversation.contact)}`}
      sx={{
        gap: 1.5,
        py: 1.25,
        px: 1.5,
        alignItems: 'flex-start',
        borderBottom: 1,
        borderColor: 'divider',
        opacity: conversation.status === 'CLOSED' ? 0.75 : 1,
        '&.Mui-selected': { bgcolor: colors.selected },
        ...(lineColor && {
          borderLeft: `3px solid ${lineColor}`,
          bgcolor: alpha(lineColor, 0.06),
          '&:hover': { bgcolor: alpha(lineColor, 0.12) },
          '&.Mui-selected, &.Mui-selected:hover': { bgcolor: alpha(lineColor, 0.18) },
        }),
      }}
    >
      <Tooltip title={conversation.lineName ?? 'Línea eliminada'} placement="right">
        <Badge
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          badgeContent={<LineBadge lineName={conversation.lineName} color={lineColor} />}
        >
          <ContactAvatar contact={conversation.contact} ring={lineColor} />
        </Badge>
      </Tooltip>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography noWrap sx={{ flex: 1, fontWeight: unread ? 700 : 500 }}>
            {contactName(conversation.contact)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: unread ? colors.unread : 'text.secondary',
              fontWeight: unread ? 700 : 400,
              flexShrink: 0,
            }}
          >
            {listTime(last?.at ?? conversation.lastActivityAt)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          {last?.direction === 'OUT' && <LastDelivery status={last.status} colors={colors} />}
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, color: unread ? 'text.primary' : 'text.secondary' }}
          >
            {preview(last)}
          </Typography>
          {unread && (
            <Box
              aria-label={`${conversation.unreadCount} sin leer`}
              sx={{
                minWidth: 20,
                height: 20,
                px: 0.75,
                borderRadius: 10,
                bgcolor: colors.unread,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </Box>
          )}
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.5, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flex: 1, minWidth: 0, overflow: 'hidden', alignItems: 'center' }}
          >
            {chips.slice(0, 2).map((tag) => (
              <Chip
                key={tag.id}
                size="small"
                variant="outlined"
                label={tag.name}
                sx={{
                  height: 20,
                  maxWidth: 130,
                  fontSize: 11,
                  fontWeight: 600,
                  borderColor: tag.color,
                  color: tag.color,
                }}
              />
            ))}
            {chips.length > 2 && (
              <Chip
                size="small"
                label={`+${chips.length - 2}`}
                title={chips
                  .slice(2)
                  .map((tag) => tag.name)
                  .join(', ')}
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
            {conversation.status !== 'OPEN' && (
              <Typography
                variant="caption"
                noWrap
                sx={{
                  fontWeight: 600,
                  color: conversation.status === 'ON_HOLD' ? 'warning.main' : 'text.secondary',
                }}
              >
                {STATUS_LABELS[conversation.status]}
              </Typography>
            )}
          </Stack>
          {/* Who attends the chat, small and in its own color: «Tú» or «C. Arze». */}
          <Box
            component="span"
            title={assignee ? `Atiende ${assignee.name}` : 'Sin asignar'}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.25,
              flexShrink: 0,
              maxWidth: '45%',
              fontSize: 12,
              fontWeight: 600,
              color: assignee ? (mine ? colors.agent : 'text.secondary') : 'warning.main',
            }}
          >
            <PersonOutlineRounded sx={{ fontSize: 14, flexShrink: 0 }} />
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {assignee ? (mine ? 'Tú' : shortName(assignee.name)) : 'Sin asignar'}
            </Box>
          </Box>
        </Stack>
      </Box>
    </ListItemButton>
  )
}
