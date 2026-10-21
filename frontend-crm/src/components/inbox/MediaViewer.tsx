import CloseRounded from '@mui/icons-material/CloseRounded'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import DownloadRounded from '@mui/icons-material/DownloadRounded'
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Dialog,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { errorMessage } from '../../lib/api/errors'
import { inboxApi, type ChatMessage } from '../../lib/api/inbox'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { formatBytes, useMediaUrl } from './media-url'

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 1 }}>
      <Typography variant="body2" color="error">
        {errorMessage(error) || 'No se pudo cargar el archivo'}
      </Typography>
      <Tooltip title="Reintentar">
        <IconButton size="small" aria-label="Reintentar descarga" onClick={onRetry}>
          <RefreshRounded fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

function ImageMedia({ message, sticker }: { message: ChatMessage; sticker: boolean }) {
  const { url, file } = useMediaUrl(message)
  const [open, setOpen] = useState(false)
  const size = sticker ? 140 : 280
  if (file.error) return <Failed error={file.error} onRetry={() => void file.refetch()} />
  if (!url) return <Skeleton variant="rounded" width={size} height={sticker ? size : 200} />
  const alt = message.media?.caption ?? (sticker ? 'Sticker' : 'Imagen')
  return (
    <>
      <Box
        component="img"
        src={url}
        alt={alt}
        onClick={sticker ? undefined : () => setOpen(true)}
        sx={{
          display: 'block',
          maxWidth: size,
          maxHeight: sticker ? size : 320,
          width: sticker ? size : 'auto',
          borderRadius: sticker ? 0 : 1.5,
          cursor: sticker ? 'default' : 'zoom-in',
          objectFit: 'contain',
        }}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" aria-label="Imagen ampliada">
        <Box sx={{ position: 'relative', bgcolor: 'common.black' }}>
          <IconButton
            aria-label="Cerrar imagen"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', top: 8, right: 8, color: 'common.white' }}
          >
            <CloseRounded />
          </IconButton>
          <IconButton
            aria-label="Descargar imagen"
            component="a"
            href={url}
            download={message.media?.filename ?? 'imagen'}
            sx={{ position: 'absolute', top: 8, right: 56, color: 'common.white' }}
          >
            <DownloadRounded />
          </IconButton>
          <Box
            component="img"
            src={url}
            alt={alt}
            sx={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh' }}
          />
        </Box>
      </Dialog>
    </>
  )
}

function PlayerMedia({ message }: { message: ChatMessage }) {
  const { url, file } = useMediaUrl(message)
  const video = message.type === 'video'
  if (file.error) return <Failed error={file.error} onRetry={() => void file.refetch()} />
  if (!url)
    return video ? (
      <Skeleton variant="rounded" width={280} height={160} />
    ) : (
      <Skeleton variant="rounded" width={260} height={40} />
    )
  return video ? (
    <Box
      component="video"
      src={url}
      controls
      preload="metadata"
      aria-label="Video recibido"
      sx={{ display: 'block', maxWidth: 320, maxHeight: 320, borderRadius: 1.5 }}
    />
  ) : (
    <Box
      component="audio"
      src={url}
      controls
      preload="metadata"
      aria-label="Audio"
      sx={{ display: 'block', width: { xs: 220, sm: 280 } }}
    />
  )
}

function DocumentMedia({ message }: { message: ChatMessage }) {
  const workspaceId = useActiveWorkspace().active?.id ?? ''
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const name = message.media?.filename ?? 'Documento'
  const pdf = message.media?.mimeType === 'application/pdf'
  const download = async () => {
    setDownloading(true)
    setError(null)
    try {
      const blob = await inboxApi.media(workspaceId, message.conversationId, message.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (caught: unknown) {
      setError(caught)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: 'center',
          p: 1,
          borderRadius: 1.5,
          bgcolor: 'action.hover',
          minWidth: 220,
        }}
      >
        {pdf ? <PictureAsPdfOutlined color="error" /> : <DescriptionOutlined color="primary" />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {[
              message.media?.mimeType?.split('/')[1]?.toUpperCase(),
              formatBytes(message.media?.size),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
        <Tooltip title="Descargar">
          <span>
            <IconButton
              aria-label={`Descargar ${name}`}
              onClick={() => void download()}
              disabled={downloading || !!message.localFile}
            >
              <DownloadRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {error !== null && (
        <Button size="small" color="error" onClick={() => void download()}>
          {errorMessage(error)} · Reintentar
        </Button>
      )}
    </Box>
  )
}

/** The file of a message: image, sticker, audio, video or document. */
export function MediaViewer({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'image':
      return <ImageMedia message={message} sticker={false} />
    case 'sticker':
      return <ImageMedia message={message} sticker />
    case 'audio':
    case 'video':
      return <PlayerMedia message={message} />
    default:
      return <DocumentMedia message={message} />
  }
}
