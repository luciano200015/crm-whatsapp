import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined'
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined'
import MarkChatUnreadOutlined from '@mui/icons-material/MarkChatUnreadOutlined'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import PauseCircleOutlineRounded from '@mui/icons-material/PauseCircleOutlineRounded'
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
import { botPaused, botPauseText, timeLeft } from './bot-pause'
import { ContactAvatar } from './ConversationList'
import { contactName } from './inbox-format'

export type ChatAction =
  | { name: 'take' | 'hold' | 'reopen' | 'unread' }
  /** sendMessage: the closing message goes first («Preguntar para enviar»). */
  | { name: 'close'; sendMessage?: boolean }
  | { name: 'assign'; membershipId: string | null }

function HeaderAction({
  label,
  icon,
  color,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  color: 'primary' | 'success' | 'warning'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton aria-label={label} color={color} disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
}

/**
 * Chat header, as in wasapi: only closing the chat (and taking it while
 * nobody has it) stays at hand; everything else lives in the ⋮ menu.
 */
export function ChatHeader({
  conversation,
  members,
  canTransfer = false,
  canUnassign = false,
  busy,
  onAction,
  onBack,
  detailsOpen,
  onToggleDetails,
  blocked = false,
  lineColor,
  tagChips,
  renderTagPopover,
  extraMenuItems,
}: {
  conversation: Conversation
  members: Assignee[]
  /** conversations.assign, or an own chat while «Transferencia de chats» is on. */
  canTransfer?: boolean
  /** Only conversations.assign leaves a chat unassigned. */
  canUnassign?: boolean
  busy: boolean
  onAction: (action: ChatAction) => void
  onBack: () => void
  /** The details panel (contact) is showing. */
  detailsOpen: boolean
  onToggleDetails: () => void
  /** The contact is blocked: shown next to the name. */
  blocked?: boolean
  /** Color of the chat's line, around the avatar. */
  lineColor?: string | null
  /** Tags of the chat, under the name. */
  tagChips?: ReactNode
  /** "Etiquetar chat", opened from the menu next to the ⋮ button. */
  renderTagPopover?: (anchorEl: HTMLElement | null, onClose: () => void) => ReactNode
  /** More entries for the ⋮ menu (e.g. block contact); they close the menu themselves. */
  extraMenuItems?: (close: () => void) => ReactNode
}) {
  const { has } = usePermissions()
  // The ⋮ button: the menu, the transfer list and the tags open next to it.
  const [more, setMore] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const assigneeId = conversation.assignee?.membershipId ?? null
  const canSend = has('messages.send')
  const run = (action: ChatAction) => {
    setTransferOpen(false)
    setMenuOpen(false)
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
        onClick={onToggleDetails}
        aria-label={detailsOpen ? 'Ocultar detalles' : 'Ver detalles'}
        aria-expanded={detailsOpen}
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
        <ContactAvatar contact={conversation.contact} size={40} ring={lineColor} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {contactName(conversation.contact)}
            </Typography>
            {blocked && <Chip size="small" color="error" label="Bloqueado" />}
            {conversation.bot &&
              conversation.bot.state !== 'none' &&
              (botPaused(conversation.bot) ? (
                <Tooltip title={botPauseText(conversation.bot)}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color="warning"
                    label={
                      conversation.bot.pausedUntil
                        ? `🤖 Bot off · ${timeLeft(conversation.bot.pausedUntil)}`
                        : '🤖 Bot off permanente'
                    }
                  />
                </Tooltip>
              ) : (
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label="🤖 Bot activo"
                  title={`${conversation.bot.name ?? 'El bot'} responde en este chat`}
                />
              ))}
          </Stack>
          <Typography variant="caption" noWrap component="div" color="text.secondary">
            {conversation.contact.phone} · {conversation.lineName ?? 'Línea eliminada'} ·{' '}
            {conversation.assignee ? `Atiende ${conversation.assignee.name}` : 'Sin asignar'}
          </Typography>
          {tagChips}
        </Box>
      </Box>

      {canSend && !conversation.assignee && (
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => run({ name: 'take' })}
        >
          Tomar chat
        </Button>
      )}
      {canSend &&
        (conversation.status === 'CLOSED' ? (
          <HeaderAction
            label="Reabrir chat"
            icon={<LockOpenOutlined />}
            color="primary"
            disabled={busy}
            onClick={() => run({ name: 'reopen' })}
          />
        ) : (
          <HeaderAction
            label="Cerrar chat"
            icon={<TaskAltRounded />}
            color="success"
            disabled={busy}
            onClick={() => run({ name: 'close' })}
          />
        ))}
      <IconButton
        aria-label="Más opciones"
        aria-haspopup="menu"
        onClick={(event) => {
          setMore(event.currentTarget)
          setMenuOpen(true)
        }}
      >
        <MoreVertRounded />
      </IconButton>
      <Menu anchorEl={more} open={menuOpen} onClose={() => setMenuOpen(false)}>
        {renderTagPopover && (
          <MenuItem
            onClick={() => {
              setMenuOpen(false)
              setTagsOpen(true)
            }}
          >
            <ListItemIcon>
              <LocalOfferOutlined />
            </ListItemIcon>
            <ListItemText>Etiquetar chat</ListItemText>
          </MenuItem>
        )}
        {canTransfer && (
          <MenuItem
            disabled={busy}
            aria-haspopup="menu"
            onClick={() => {
              setMenuOpen(false)
              setTransferOpen(true)
            }}
          >
            <ListItemIcon>
              <SwapHorizRounded />
            </ListItemIcon>
            <ListItemText>Transferir</ListItemText>
          </MenuItem>
        )}
        {canSend && conversation.status === 'OPEN' && (
          <MenuItem disabled={busy} onClick={() => run({ name: 'hold' })}>
            <ListItemIcon>
              <PauseCircleOutlineRounded color="warning" />
            </ListItemIcon>
            <ListItemText>Poner en espera</ListItemText>
          </MenuItem>
        )}
        {canSend && conversation.status === 'ON_HOLD' && (
          <MenuItem disabled={busy} onClick={() => run({ name: 'reopen' })}>
            <ListItemIcon>
              <LockOpenOutlined color="primary" />
            </ListItemIcon>
            <ListItemText>Reabrir chat</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => run({ name: 'unread' })} disabled={busy}>
          <ListItemIcon>
            <MarkChatUnreadOutlined />
          </ListItemIcon>
          <ListItemText>Marcar como no leído</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuOpen(false)
            onToggleDetails()
          }}
        >
          <ListItemIcon>
            <InfoOutlined />
          </ListItemIcon>
          <ListItemText>{detailsOpen ? 'Ocultar detalles' : 'Ver detalles'}</ListItemText>
        </MenuItem>
        {extraMenuItems?.(() => setMenuOpen(false))}
      </Menu>
      {canTransfer && (
        <Menu
          anchorEl={more}
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
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
          {canUnassign && <Divider />}
          {canUnassign && (
            <MenuItem
              disabled={!assigneeId}
              onClick={() => run({ name: 'assign', membershipId: null })}
            >
              <ListItemText inset>Dejar sin asignar</ListItemText>
            </MenuItem>
          )}
        </Menu>
      )}
      {renderTagPopover?.(tagsOpen ? more : null, () => setTagsOpen(false))}
    </Stack>
  )
}
