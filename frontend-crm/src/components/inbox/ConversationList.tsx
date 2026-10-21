import PersonRounded from '@mui/icons-material/PersonRounded'
import { Avatar, Box, ListItemButton, Stack, Typography } from '@mui/material'
import type { Conversation } from '../../lib/api/inbox'
import { useChatColors } from './chat-colors'
import {
  avatarColor,
  contactName,
  initials,
  listTime,
  preview,
  STATUS_LABELS,
} from './inbox-format'

export function ContactAvatar({
  contact,
  size = 48,
}: {
  contact: Conversation['contact']
  size?: number
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
      }}
    >
      {initials(name)}
    </Avatar>
  )
}

/** One row of the chat list, as in WhatsApp: avatar, name, time, preview, unread badge. */
export function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation
  selected: boolean
  onSelect: () => void
}) {
  const colors = useChatColors()
  const unread = conversation.unreadCount > 0
  const closed = conversation.status === 'CLOSED'
  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      aria-label={`Chat con ${contactName(conversation.contact)}`}
      sx={{
        gap: 1.5,
        py: 1.25,
        px: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        opacity: closed ? 0.7 : 1,
        '&.Mui-selected': { bgcolor: colors.selected },
      }}
    >
      <ContactAvatar contact={conversation.contact} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography noWrap sx={{ flex: 1, fontWeight: unread ? 700 : 500 }}>
            {contactName(conversation.contact)}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: unread ? colors.unread : 'text.secondary', flexShrink: 0 }}
          >
            {listTime(conversation.lastMessage?.at ?? conversation.lastActivityAt)}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, color: unread ? 'text.primary' : 'text.secondary' }}
          >
            {preview(conversation.lastMessage)}
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
              }}
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </Box>
          )}
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.5, minWidth: 0 }}>
          {/* Who attends the chat, small but in its own color so it stands out. */}
          <Box
            component="span"
            title={conversation.assignee ? `Atiende ${conversation.assignee.name}` : 'Sin asignar'}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.4,
              minWidth: 0,
              maxWidth: '60%',
              px: 0.75,
              py: '1px',
              borderRadius: 1,
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.6,
              bgcolor: conversation.assignee ? colors.agentBg : colors.unassignedBg,
              color: conversation.assignee ? colors.agent : 'warning.main',
            }}
          >
            <PersonRounded sx={{ fontSize: 13, flexShrink: 0 }} />
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {conversation.assignee?.name ?? 'Sin asignar'}
            </Box>
          </Box>
          <Typography variant="caption" noWrap color="text.secondary" sx={{ minWidth: 0, flex: 1 }}>
            {conversation.lineName ?? 'Línea eliminada'}
          </Typography>
          {conversation.status !== 'OPEN' && (
            <Typography
              variant="caption"
              sx={{
                flexShrink: 0,
                fontWeight: 600,
                color: conversation.status === 'ON_HOLD' ? 'warning.main' : 'text.secondary',
              }}
            >
              {STATUS_LABELS[conversation.status]}
            </Typography>
          )}
        </Stack>
      </Box>
    </ListItemButton>
  )
}
