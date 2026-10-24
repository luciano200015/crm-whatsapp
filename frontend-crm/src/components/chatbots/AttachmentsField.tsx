import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { chatbotsApi, type BotMedia } from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'

const t = es.chatbots.node

/** Files of a node; each one goes as its own WhatsApp message. */
export const MAX_ATTACHMENTS = 5

const ACCEPT =
  'image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/mpeg,audio/mp4,audio/ogg,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt'

/** "Adjuntar archivos": uploads them for the chatbot and lists them. */
export function AttachmentsField({
  workspaceId,
  chatbotId,
  value,
  help,
  onChange,
}: {
  workspaceId: string
  chatbotId: string
  value: BotMedia[]
  help: string
  onChange: (attachments: BotMedia[]) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (files: File[]) => {
    setUploading(true)
    setError(null)
    const added: BotMedia[] = []
    try {
      for (const file of files.slice(0, MAX_ATTACHMENTS - value.length)) {
        added.push(await chatbotsApi.uploadMedia(workspaceId, chatbotId, file))
      }
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      if (added.length > 0) onChange([...value, ...added])
      setUploading(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {help}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {value.length > 0 && (
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {value.map((media) => (
            <Chip
              key={media.fileId}
              icon={<AttachFileRounded />}
              label={media.filename}
              onDelete={() => onChange(value.filter((item) => item.fileId !== media.fileId))}
              deleteIcon={<CloseRounded aria-label={t.removeFile(media.filename)} />}
              sx={{ maxWidth: '100%' }}
            />
          ))}
        </Stack>
      )}
      {value.length < MAX_ATTACHMENTS && (
        <Box>
          <Button
            component="label"
            size="small"
            variant="outlined"
            startIcon={<AttachFileRounded />}
            disabled={uploading}
          >
            {uploading ? t.uploading : t.attach}
            <input
              hidden
              multiple
              type="file"
              accept={ACCEPT}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                if (files.length > 0) void upload(files)
              }}
            />
          </Button>
        </Box>
      )}
    </Stack>
  )
}
