import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import PlaceOutlined from '@mui/icons-material/PlaceOutlined'
import ReplyRounded from '@mui/icons-material/ReplyRounded'
import { Box, ButtonBase, Collapse, Divider, Link, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import type { InteractiveContent } from '../../lib/api/chatbots'
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

const optionSx = {
  py: 0.75,
  justifyContent: 'center',
  gap: 0.75,
  color: 'primary.main',
  fontWeight: 600,
  fontSize: 14,
} as const

/** Buttons, list or link button of a chatbot, as the customer sees them in WhatsApp. */
function InteractiveCard({ content }: { content: InteractiveContent }) {
  const [open, setOpen] = useState(false)
  const rows = content.list?.sections.flatMap((section) => section.rows) ?? []
  return (
    <Box>
      {content.header && (
        <Typography sx={{ ...textSx, fontWeight: 700 }}>{content.header}</Typography>
      )}
      <Typography sx={textSx}>{content.body}</Typography>
      {content.footer && (
        <Typography variant="caption" color="text.secondary" component="div">
          {content.footer}
        </Typography>
      )}
      {content.buttons?.map((button) => (
        <Box key={button.id}>
          <Divider sx={{ mt: 0.75 }} />
          <Typography sx={{ ...optionSx, display: 'flex' }} role="listitem">
            {button.title}
          </Typography>
        </Box>
      ))}
      {content.list && (
        <>
          <Divider sx={{ mt: 0.75 }} />
          <ButtonBase
            sx={{ ...optionSx, width: '100%', display: 'flex' }}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <FormatListBulletedRounded fontSize="small" />
            {content.list.button || 'Ver opciones'}
          </ButtonBase>
          <Collapse in={open}>
            <Stack spacing={0.5} sx={{ pb: 0.5 }} aria-label="Opciones de la lista">
              {rows.map((row) => (
                <Box key={row.id} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="body2">{row.title}</Typography>
                  {row.description && (
                    <Typography variant="caption" color="text.secondary">
                      {row.description}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </Collapse>
        </>
      )}
      {content.url && (
        <>
          <Divider sx={{ mt: 0.75 }} />
          <Link
            href={content.url.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="none"
            sx={{ ...optionSx, display: 'flex', alignItems: 'center' }}
          >
            <OpenInNewRounded fontSize="small" />
            {content.url.text}
          </Link>
        </>
      )}
    </Box>
  )
}

/** Body of a message: text, media or location. */
export function MessageContent({ message }: { message: ChatMessage }) {
  if (message.type === 'interactive') {
    if (!message.interactive) return <Typography sx={textSx}>{message.text}</Typography>
    // A chatbot's buttons can carry an image, video or document above them.
    const header = message.media?.mimeType ?? ''
    return (
      <Stack spacing={0.75}>
        {message.media && (
          <MediaViewer
            message={{
              ...message,
              type: header.startsWith('image/')
                ? 'image'
                : header.startsWith('video/')
                  ? 'video'
                  : 'document',
            }}
          />
        )}
        <InteractiveCard content={message.interactive} />
      </Stack>
    )
  }
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
    if (message.reply) {
      // The customer tapped a button or a row of a list.
      return (
        <Box>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', color: 'text.secondary' }}
          >
            <ReplyRounded sx={{ fontSize: 14 }} />
            <Typography variant="caption">Eligió una opción</Typography>
          </Stack>
          <Typography sx={{ ...textSx, fontWeight: 600 }}>
            {message.text || message.reply.title}
          </Typography>
        </Box>
      )
    }
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
