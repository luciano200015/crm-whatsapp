import SendRounded from '@mui/icons-material/SendRounded'
import StickyNote2Outlined from '@mui/icons-material/StickyNote2Outlined'
import {
  Alert,
  Box,
  IconButton,
  InputBase,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import { useState } from 'react'
import { useChatColors } from './chat-colors'

export type ComposerMode = 'reply' | 'note'

/**
 * Message editor at the bottom of the chat. Enter sends, Shift+Enter adds a
 * line. In "note" mode the text stays inside the team.
 */
export function Composer({
  replyBlockedReason,
  sending,
  onSend,
}: {
  /** Why WhatsApp replies are not possible now (closed chat, 24 h window); notes still work. */
  replyBlockedReason: string | null
  sending: boolean
  /** Resolves true when it was saved, so the text can be cleared. */
  onSend: (text: string, mode: ComposerMode) => Promise<boolean>
}) {
  const colors = useChatColors()
  const [mode, setMode] = useState<ComposerMode>('reply')
  const [text, setText] = useState('')
  const note = mode === 'note'
  const blocked = !note && replyBlockedReason !== null
  const canSend = !blocked && !sending && text.trim().length > 0
  const submit = () => {
    if (!canSend) return
    void onSend(text.trim(), mode).then((saved) => {
      if (saved) setText('')
    })
  }
  return (
    <Box sx={{ bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', px: 2, py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, value: ComposerMode | null) => {
            if (value) setMode(value)
          }}
        >
          <ToggleButton value="reply">Responder</ToggleButton>
          <ToggleButton value="note">
            <StickyNote2Outlined fontSize="small" sx={{ mr: 0.5 }} />
            Nota interna
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {note && (
        <Alert severity="info" sx={{ mb: 1, py: 0 }}>
          Solo tu equipo verá esta nota. No se envía a WhatsApp.
        </Alert>
      )}
      {blocked && (
        <Alert severity="warning" sx={{ mb: 1, py: 0 }}>
          {replyBlockedReason}
        </Alert>
      )}
      <Stack
        component="form"
        direction="row"
        spacing={1}
        sx={{ alignItems: 'flex-end' }}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <InputBase
          multiline
          maxRows={6}
          placeholder={note ? 'Escribe una nota para tu equipo' : 'Escribe un mensaje'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          disabled={blocked || sending}
          inputProps={{
            maxLength: 4096,
            'aria-label': note ? 'Escribir nota interna' : 'Escribir respuesta',
          }}
          sx={{
            flex: 1,
            px: 2,
            py: 1,
            borderRadius: 3,
            bgcolor: note ? colors.note : 'action.hover',
          }}
        />
        <Tooltip title={note ? 'Guardar nota' : 'Enviar'}>
          <span>
            <IconButton
              type="submit"
              color="primary"
              disabled={!canSend}
              aria-label={note ? 'Guardar nota' : 'Enviar respuesta'}
              sx={{
                bgcolor: canSend ? colors.unread : undefined,
                color: canSend ? '#fff' : undefined,
                '&:hover': { bgcolor: canSend ? colors.unread : undefined },
              }}
            >
              <SendRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  )
}
