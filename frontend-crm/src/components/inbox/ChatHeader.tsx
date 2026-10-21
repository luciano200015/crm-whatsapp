import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined'
import MarkChatUnreadOutlined from '@mui/icons-material/MarkChatUnreadOutlined'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded'
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded'
import TaskAltRounded from '@mui/icons-material/TaskAltRounded'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import type { Assignee, Conversation } from '../../lib/api/inbox'
import { ContactAvatar } from './ConversationList'
import { contactName } from './inbox-format'

export type ChatAction =
  { name: 'take' | 'close' | 'reopen' | 'unread' } | { name: 'assign'; membershipId: string | null }

export function ChatHeader({
  conversation,
  members,
  busy,
  onAction,
  onBack,
  onToggleInfo,
  blocked = false,
  extraMenuItems,
}: {
  conversation: Conversation
  members: Assignee[]
  busy: boolean
  onAction: (action: ChatAction) => void
  onBack: () => void
  onToggleInfo: () => void
  /** The contact is blocked: shown next to the name. */
  blocked?: boolean
  /** More entries for the ⋮ menu (e.g. block contact); they close the menu themselves. */
  extraMenuItems?: (close: () => void) => ReactNode
}) {
  const { has } = usePermissions()
  const [transferAnchor, setTransferAnchor] = useState<HTMLElement | null>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const open = conversation.status === 'OPEN'
  const assigneeId = conversation.assignee?.membershipId ?? null
  const run = (action: ChatAction) => {
    setTransferAnchor(null)
    setMoreAnchor(null)
    onAction(action)
  }
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        alignItems: 'center',
        px: 1.5,
        py: 1,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        minHeight: 64,
      }}
    >
      <IconButton
        aria-label="Volver a la lista"
        onClick={onBack}
        sx={{ display: { md: 'none' } }}
        edge="start"
      >
        <ArrowBackRounded />
      </IconButton>
      <Box
        component="button"
        type="button"
        onClick={onToggleInfo}
        aria-label="Ver contacto"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minWidth: 0,
          flex: 1,
          border: 0,
          p: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <ContactAvatar contact={conversation.contact} size={40} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {contactName(conversation.contact)}
            </Typography>
            {blocked && <Chip size="small" color="error" label="Bloqueado" />}
          </Stack>
          <Typography variant="caption" noWrap component="div" color="text.secondary">
            {conversation.contact.phone} · {conversation.lineName ?? 'Línea eliminada'} ·{' '}
            {conversation.assignee ? `Atiende ${conversation.assignee.name}` : 'Sin asignar'}
          </Typography>
        </Box>
      </Box>

      {has('messages.send') && !conversation.assignee && (
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => run({ name: 'take' })}
        >
          Tomar chat
        </Button>
      )}
      {has('conversations.assign') && (
        <>
          <Tooltip title="Transferir">
            <span>
              <IconButton
                aria-label="Transferir"
                disabled={busy}
                onClick={(event) => setTransferAnchor(event.currentTarget)}
                aria-haspopup="menu"
              >
                <SwapHorizRounded />
              </IconButton>
            </span>
          </Tooltip>
          <Menu
            anchorEl={transferAnchor}
            open={!!transferAnchor}
            onClose={() => setTransferAnchor(null)}
            slotProps={{ list: { 'aria-label': 'Transferir chat a' } }}
          >
            {members.map((member) => (
              <MenuItem
                key={member.membershipId}
                selected={member.membershipId === assigneeId}
                onClick={() => run({ name: 'assign', membershipId: member.membershipId })}
              >
                <ListItemIcon>
                  {member.membershipId === assigneeId ? <CheckRounded /> : <PersonOutlineRounded />}
                </ListItemIcon>
                <ListItemText>{member.name}</ListItemText>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              disabled={!assigneeId}
              onClick={() => run({ name: 'assign', membershipId: null })}
            >
              <ListItemText inset>Dejar sin asignar</ListItemText>
            </MenuItem>
          </Menu>
        </>
      )}
      {has('messages.send') && (
        <Tooltip title={open ? 'Cerrar chat' : 'Reabrir chat'}>
          <span>
            <IconButton
              aria-label={open ? 'Cerrar chat' : 'Reabrir chat'}
              color={open ? 'success' : 'primary'}
              disabled={busy}
              onClick={() => run({ name: open ? 'close' : 'reopen' })}
            >
              {open ? <TaskAltRounded /> : <LockOpenOutlined />}
            </IconButton>
          </span>
        </Tooltip>
      )}
      <IconButton
        aria-label="Más opciones"
        aria-haspopup="menu"
        onClick={(event) => setMoreAnchor(event.currentTarget)}
      >
        <MoreVertRounded />
      </IconButton>
      <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => run({ name: 'unread' })} disabled={busy}>
          <ListItemIcon>
            <MarkChatUnreadOutlined />
          </ListItemIcon>
          <ListItemText>Marcar como no leído</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null)
            onToggleInfo()
          }}
        >
          <ListItemIcon>
            <PersonOutlineRounded />
          </ListItemIcon>
          <ListItemText>Ver contacto</ListItemText>
        </MenuItem>
        {extraMenuItems?.(() => setMoreAnchor(null))}
      </Menu>
    </Stack>
  )
}
