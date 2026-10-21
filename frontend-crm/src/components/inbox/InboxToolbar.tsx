import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded'
import FullscreenRounded from '@mui/icons-material/FullscreenRounded'
import GroupsRounded from '@mui/icons-material/GroupsRounded'
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import SyncRounded from '@mui/icons-material/SyncRounded'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { usePermissions } from '../../auth/usePermissions'
import { useMe } from '../../auth/useMe'
import { AlertSettings } from './AlertSettings'
import { useChatColors } from './chat-colors'
import { initials } from './inbox-format'

function ToolButton({
  label,
  onClick,
  active = false,
  children,
  sx,
}: {
  label: string
  onClick: (event: MouseEvent<HTMLElement>) => void
  active?: boolean
  children: ReactNode
  sx?: SxProps<Theme>
}) {
  const colors = useChatColors()
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        aria-pressed={active || undefined}
        onClick={onClick}
        sx={{
          width: 38,
          height: 38,
          bgcolor: active ? colors.agentBg : 'action.hover',
          color: active ? colors.agent : 'text.secondary',
          '&:hover': { bgcolor: active ? colors.agentBg : 'action.selected' },
          ...sx,
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

/**
 * Top bar of the chat list, as in wasapi: who you are, help, settings,
 * full screen, "mine + my agents" view, sync and more options.
 */
export function InboxToolbar({
  teamView,
  onTeamViewChange,
  fullscreen,
  onToggleFullscreen,
  syncing,
  onSync,
}: {
  teamView: boolean
  onTeamViewChange: (value: boolean) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  syncing: boolean
  onSync: () => void
}) {
  const { has } = usePermissions()
  const me = useMe().data
  const colors = useChatColors()
  const [help, setHelp] = useState(false)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const name = me?.displayName ?? ''
  const links = [
    { to: '/quick-replies', label: 'Respuestas rápidas', allowed: has('quick_replies.manage') },
    { to: '/inbox/auto-assignment', label: 'Autoasignación', allowed: has('channels.manage') },
    { to: '/channels/lines', label: 'Líneas de WhatsApp', allowed: has('channels.read') },
  ].filter((link) => link.allowed)

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Tooltip title={name}>
        <Badge
          overlap="circular"
          variant="dot"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ '& .MuiBadge-badge': { bgcolor: colors.unread } }}
        >
          <Avatar
            aria-label={`Sesión de ${name}`}
            sx={{ width: 38, height: 38, bgcolor: colors.agentBg, color: colors.agent }}
          >
            {initials(name || '?')}
          </Avatar>
        </Badge>
      </Tooltip>
      <ToolButton label="Ayuda" onClick={() => setHelp(true)}>
        <HelpOutlineRounded fontSize="small" />
      </ToolButton>
      <AlertSettings
        label="Configuración"
        icon={<SettingsOutlined fontSize="small" />}
        buttonSx={{ width: 38, height: 38, bgcolor: 'action.hover', color: 'text.secondary' }}
      />
      <ToolButton
        label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? (
          <CloseFullscreenRounded fontSize="small" />
        ) : (
          <FullscreenRounded fontSize="small" />
        )}
      </ToolButton>
      <ToolButton
        label="Mostrar mis conversaciones abiertas y las de mis agentes"
        active={teamView}
        onClick={() => onTeamViewChange(!teamView)}
      >
        <GroupsRounded fontSize="small" />
      </ToolButton>
      <ToolButton label="Sincronizar chats" onClick={onSync}>
        <SyncRounded
          fontSize="small"
          sx={{
            '@keyframes inbox-sync-spin': {
              from: { transform: 'rotate(0deg)' },
              to: { transform: 'rotate(360deg)' },
            },
            animation: syncing ? 'inbox-sync-spin 1s linear infinite' : 'none',
          }}
        />
      </ToolButton>
      <Box sx={{ flex: 1 }} />
      {links.length > 0 && (
        <>
          <Tooltip title="Más opciones de la bandeja">
            <IconButton
              aria-label="Más opciones de la bandeja"
              onClick={(event) => setMenu(event.currentTarget)}
            >
              <MoreVertRounded />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            {links.map((link) => (
              <MenuItem key={link.to} component={Link} to={link.to} onClick={() => setMenu(null)}>
                {link.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </Stack>
  )
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Enter', 'Enviar el mensaje'],
    ['Shift + Enter', 'Salto de línea'],
    ['/ y el atajo', 'Insertar una respuesta rápida'],
    ['✓ · ✓✓ · ✓✓ azul', 'Enviado · entregado · leído'],
    ['⚠ No entregado', 'WhatsApp lo rechazó: el chat explica por qué y permite reintentar'],
    ['Abierto', 'Chats que se están atendiendo (incluye los sin asignar)'],
    ['En espera', 'Puestos en espera por el agente; siguen en espera aunque el cliente escriba'],
    ['Cerrado', 'Atención terminada; si el cliente vuelve a escribir, se reabre sin asignar'],
    [
      'Botón de agentes',
      'Encendido: tus chats, los de tus agentes y los sin asignar. Apagado: solo los tuyos',
    ],
  ]
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Ayuda de la bandeja</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {rows.map(([key, text]) => (
            <Stack key={key} direction="row" spacing={2}>
              <Typography sx={{ fontWeight: 600, minWidth: 150, flexShrink: 0 }}>{key}</Typography>
              <Typography color="text.secondary">{text}</Typography>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Entendido</Button>
      </DialogActions>
    </Dialog>
  )
}
