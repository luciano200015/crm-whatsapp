import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { formatBytes, useObjectUrl } from './media-url'

/** Preview of a file before sending it, with an optional caption. */
export function AttachmentDialog({
  file,
  sending,
  onClose,
  onSend,
}: {
  file: File
  sending: boolean
  onClose: () => void
  onSend: (caption: string | null) => void
}) {
  const [caption, setCaption] = useState('')
  const url = useObjectUrl(file)
  const image = file.type.startsWith('image/')
  const video = file.type.startsWith('video/')
  const audio = file.type.startsWith('audio/')
  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Enviar archivo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          {url && image && (
            <Box
              component="img"
              src={url}
              alt={file.name}
              sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: 2 }}
            />
          )}
          {url && video && (
            <Box
              component="video"
              src={url}
              controls
              sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: 2 }}
            />
          )}
          {url && audio && <Box component="audio" src={url} controls sx={{ width: '100%' }} />}
          {!image && !video && !audio && (
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', alignSelf: 'stretch' }}
            >
              <DescriptionOutlined color="primary" sx={{ fontSize: 40 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatBytes(file.size)}
                </Typography>
              </Box>
            </Stack>
          )}
          {!audio && (
            <TextField
              label="Agregar un comentario"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              fullWidth
              multiline
              maxRows={4}
              slotProps={{ htmlInput: { maxLength: 1024 } }}
              disabled={sending}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={sending}
          onClick={() => onSend(caption.trim() || null)}
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
