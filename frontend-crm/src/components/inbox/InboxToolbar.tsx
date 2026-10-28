import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded'
import FullscreenRounded from '@mui/icons-material/FullscreenRounded'
import GroupsRounded from '@mui/icons-material/GroupsRounded'
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import SyncRounded from '@mui/icons-material/SyncRounded'
import {
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
import type { InboxOptions } from '../../lib/api/inbox'
import { ChatSettingsDialog } from './ChatSettingsDialog'
import { ProfileButton } from './ProfileButton'
import { useChatColors } from './chat-colors'

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
  workspaceId,
  options,
  teamView,
  onTeamViewChange,
  fullscreen,
  onToggleFullscreen,
  syncing,
  onSync,
}: {
  workspaceId: string
  options: InboxOptions | undefined
  teamView: boolean
  onTeamViewChange: (value: boolean) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  syncing: boolean
  onSync: () => void
}) {
  const { has } = usePermissions()
  const [help, setHelp] = useState(false)
  const [settings, setSettings] = useState(false)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  // Auto-assignment lives in the settings; quick replies open from the chat.
  const links = [
    { to: '/funnels', label: 'Embudos', allowed: has('funnels.read') },
    { to: '/channels/lines', label: 'Líneas de WhatsApp', allowed: has('channels.read') },
  ].filter((link) => link.allowed)

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <ProfileButton options={options} />
      <ToolButton label="Ayuda" onClick={() => setHelp(true)}>
        <HelpOutlineRounded fontSize="small" />
      </ToolButton>
      <ToolButton label="Configuración del módulo de chat" onClick={() => setSettings(true)}>
        <SettingsOutlined fontSize="small" />
      </ToolButton>
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
      <ChatSettingsDialog
        workspaceId={workspaceId}
        open={settings}
        onClose={() => setSettings(false)}
      />
    </Stack>
  )
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Enter', 'Enviar el mensaje'],
    ['Shift + Enter', 'Salto de línea'],
    ['/ al inicio del mensaje', 'Abre las respuestas rápidas para buscarlas y enviarlas'],
    ['✓ · ✓✓ · ✓✓ azul', 'Enviado · entregado · leído'],
    ['⚠ No entregado', 'WhatsApp lo rechazó: el chat explica por qué y permite reintentar'],
    ['Abierto', 'Chats que se están atendiendo (incluye los sin asignar)'],
    [
      'En espera',
      'Puestos en espera; siguen ahí aunque el cliente escriba. «Aceptar» te los asigna y los abre',
    ],
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
