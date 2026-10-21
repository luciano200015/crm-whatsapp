import WhatsApp from '@mui/icons-material/WhatsApp'
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Divider,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useMe } from '../../auth/useMe'
import { es } from '../../i18n/es'
import type { InboxOptions } from '../../lib/api/inbox'
import type { LineStatus } from '../../lib/api/types'
import { roleName } from '../../lib/team'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { useChatColors } from './chat-colors'
import { initials } from './inbox-format'

/**
 * Your avatar in the inbox bar. Clicking it shows who you are and the
 * WhatsApp numbers whose chats reach you.
 */
export function ProfileButton({ options }: { options: InboxOptions | undefined }) {
  const me = useMe().data
  const { active } = useActiveWorkspace()
  const colors = useChatColors()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const name = me?.displayName ?? ''
  const role = active?.roles[0]
  const viewAll = options?.viewAll ?? false
  const mine = new Set(options?.myLineIds ?? [])
  // With view_all every line is listed; the assigned ones are marked.
  const lines = options?.lines ?? []

  return (
    <>
      <Tooltip title={name}>
        <IconButton
          aria-label="Mi perfil"
          aria-haspopup="dialog"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ p: 0 }}
        >
          <Badge
            overlap="circular"
            variant="dot"
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            sx={{ '& .MuiBadge-badge': { bgcolor: colors.unread } }}
          >
            <Avatar sx={{ width: 38, height: 38, bgcolor: colors.agentBg, color: colors.agent }}>
              {initials(name || '?')}
            </Avatar>
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: { sx: { width: 320, mt: 1 }, role: 'dialog', 'aria-label': 'Mi perfil' },
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ p: 2, alignItems: 'center' }}>
          <Avatar sx={{ width: 48, height: 48, bgcolor: colors.agentBg, color: colors.agent }}>
            {initials(name || '?')}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {name}
            </Typography>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {me?.email}
            </Typography>
            {role && (
              <Chip size="small" variant="outlined" label={roleName(role)} sx={{ mt: 0.5 }} />
            )}
          </Box>
        </Stack>
        <Divider />
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Mis líneas
          </Typography>
          {viewAll && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
              Tu rol ve los chats de todas las líneas.
            </Typography>
          )}
          {lines.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
              Aún no tienes líneas asignadas. Pide al propietario o a un administrador que te asigne
              un número.
            </Typography>
          ) : (
            <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
              {lines.map((line) => (
                <Stack
                  component="li"
                  key={line.id}
                  direction="row"
                  spacing={1.25}
                  sx={{ alignItems: 'center' }}
                >
                  <Avatar sx={{ width: 30, height: 30, bgcolor: '#25d366', color: '#fff' }}>
                    <WhatsApp sx={{ fontSize: 18 }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {line.name}
                    </Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
                      {line.displayPhone ?? 'Número sin verificar'}
                    </Typography>
                  </Box>
                  {line.status && line.status !== 'CONNECTED' ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={line.status === 'ERROR' ? 'error' : 'default'}
                      label={es.lines.status[line.status as LineStatus] ?? line.status}
                    />
                  ) : (
                    viewAll &&
                    mine.has(line.id) && (
                      <Chip size="small" color="success" variant="outlined" label="Asignada" />
                    )
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </Popover>
    </>
  )
}
