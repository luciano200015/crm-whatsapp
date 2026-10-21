import PlaceOutlined from '@mui/icons-material/PlaceOutlined'
import { Box, Link, Stack, Typography } from '@mui/material'
import type { ChatMessage } from '../../lib/api/inbox'
import { mediaLabel } from './inbox-format'
import { ContactCards } from './ContactCards'
import { MediaViewer } from './MediaViewer'

const textSx = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

function LocationCard({ location }: { location: NonNullable<ChatMessage['location']> }) {
  const url = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
  return (
    <Link href={url} target="_blank" rel="noopener noreferrer" underline="none" color="inherit">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5 }}>
        <PlaceOutlined color="error" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {location.name ?? 'Ubicación'}
          </Typography>
          {location.address && (
            <Typography variant="caption" component="div">
              {location.address}
            </Typography>
          )}
          <Typography variant="caption" color="primary">
            Ver en el mapa
          </Typography>
        </Box>
      </Stack>
    </Link>
  )
}

/** Body of a message: text, media or location. */
export function MessageContent({ message }: { message: ChatMessage }) {
  if (message.type === 'location') {
    return message.location ? (
      <LocationCard location={message.location} />
    ) : (
      <Typography sx={textSx}>📍 {message.text}</Typography>
    )
  }
  if (message.type === 'contacts' && message.contacts?.length) {
    return <ContactCards contacts={message.contacts} incoming={message.direction === 'IN'} />
  }
  if (message.type === 'text') {
    return <Typography sx={textSx}>{message.text}</Typography>
  }
  if (message.type === 'unsupported') {
    return (
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        Mensaje no compatible con el CRM. Revísalo en WhatsApp.
      </Typography>
    )
  }
  if (!message.media) {
    // WhatsApp sent the message without its file id.
    return (
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {mediaLabel(message.type)} no disponible
      </Typography>
    )
  }
  return (
    <Stack spacing={0.5}>
      <MediaViewer message={message} />
      {message.text && <Typography sx={textSx}>{message.text}</Typography>}
    </Stack>
  )
}
