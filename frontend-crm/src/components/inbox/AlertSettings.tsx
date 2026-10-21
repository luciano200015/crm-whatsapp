import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined'
import NotificationsOffOutlined from '@mui/icons-material/NotificationsOffOutlined'
import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  Popover,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import {
  desktopSupported,
  enableDesktopAlerts,
  playChime,
  setAlertPreferences,
  useAlertPreferences,
} from './notifications'

/** Bell of the inbox: sound and desktop notifications for new messages (per browser). */
export function AlertSettings() {
  const preferences = useAlertPreferences()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [denied, setDenied] = useState(
    () => desktopSupported() && Notification.permission === 'denied',
  )
  const on = preferences.sound || preferences.desktop
  return (
    <>
      <Tooltip title="Avisos de mensajes nuevos">
        <IconButton
          aria-label="Avisos de mensajes nuevos"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          {on ? <NotificationsActiveOutlined /> : <NotificationsOffOutlined />}
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Stack spacing={1} sx={{ p: 2, width: 300 }}>
          <Typography variant="subtitle2">Avisos de mensajes nuevos</Typography>
          <FormControlLabel
            control={
              <Switch
                checked={preferences.sound}
                onChange={(event) => setAlertPreferences({ sound: event.target.checked })}
              />
            }
            label="Sonido"
          />
          <FormControlLabel
            control={
              <Switch
                checked={preferences.desktop}
                disabled={!desktopSupported()}
                onChange={(event) => {
                  if (!event.target.checked) {
                    setAlertPreferences({ desktop: false })
                    return
                  }
                  void enableDesktopAlerts().then((granted) => setDenied(!granted))
                }}
              />
            }
            label="Notificaciones de escritorio"
          />
          {denied && (
            <Typography variant="caption" color="warning.main">
              El navegador bloqueó las notificaciones de este sitio. Permítelas en la configuración
              del sitio (icono junto a la dirección) y vuelve a activarlas.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Se guardan en este navegador. No suenan por el chat que tienes abierto.
          </Typography>
          <Box>
            <Button size="small" onClick={playChime}>
              Probar sonido
            </Button>
          </Box>
        </Stack>
      </Popover>
    </>
  )
}
