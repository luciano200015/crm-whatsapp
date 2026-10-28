import { Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useState } from 'react'
import {
  desktopSupported,
  enableDesktopAlerts,
  playChime,
  setAlertPreferences,
  useAlertPreferences,
} from './notifications'

/** Sound and desktop notifications for new messages (per browser). */
export function AlertPreferences() {
  const preferences = useAlertPreferences()
  const [denied, setDenied] = useState(
    () => desktopSupported() && Notification.permission === 'denied',
  )
  return (
    <Stack spacing={1}>
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
          El navegador bloqueó las notificaciones de este sitio. Permítelas en la configuración del
          sitio (icono junto a la dirección) y vuelve a activarlas.
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
  )
}
