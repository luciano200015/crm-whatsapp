import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import BoltRounded from '@mui/icons-material/BoltRounded'
import DrawOutlined from '@mui/icons-material/DrawOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import ContactPhoneOutlined from '@mui/icons-material/ContactPhoneOutlined'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import InsertEmoticonRounded from '@mui/icons-material/InsertEmoticonRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined'
import SendRounded from '@mui/icons-material/SendRounded'
import StickyNote2Outlined from '@mui/icons-material/StickyNote2Outlined'
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  lazy,
  Suspense,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import type { SignatureMode } from '../../lib/api/chat-settings'
import { AttachmentDialog } from './AttachmentDialog'
import { SendContactDialog, type OutgoingContact } from './SendContactDialog'
import { useChatColors } from './chat-colors'
import { ACCEPT_DOCUMENT, ACCEPT_VISUAL, fileProblem } from './outgoing-media'
import { useVoiceRecorder } from './useVoiceRecorder'

const EmojiPanel = lazy(() => import('./EmojiPanel'))

export type ComposerMode = 'reply' | 'note'

/** What the chat can do to the editor from outside (a quick reply's «Usar»). */
export interface ComposerHandle {
  useText: (text: string) => void
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function RoundButton({
  label,
  onClick,
  disabled,
  active,
  type = 'button',
  children,
}: {
  label: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  disabled?: boolean
  active?: boolean
  type?: 'button' | 'submit'
  children: ReactNode
}) {
  const colors = useChatColors()
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          type={type}
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          sx={{
            bgcolor: active ? colors.unread : undefined,
            color: active ? '#fff' : undefined,
            '&:hover': { bgcolor: active ? colors.unread : undefined },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  )
}

/**
 * Message editor at the bottom of the chat, as in WhatsApp: attach files,
 * type (Enter sends, Shift+Enter adds a line) or record a voice note. In
 * "note" mode the text stays inside the team.
 */
export function Composer({
  ref,
  replyBlockedReason,
  onSend,
  onSendFile,
  onSendContacts,
  onError,
  onOpenQuickReplies,
  signature = 'NEVER',
  sign = false,
  onSignChange,
}: {
  ref?: Ref<ComposerHandle>
  /** Why WhatsApp replies are not possible now (closed chat, 24 h window); notes still work. */
  replyBlockedReason: string | null
  /** Resolves true when it was queued, so the text can be cleared. */
  onSend: (text: string, mode: ComposerMode) => Promise<boolean>
  onSendFile: (file: File, caption: string | null) => Promise<boolean>
  onSendContacts: (contacts: OutgoingContact[]) => Promise<boolean>
  onError: (message: string) => void
  /** The quick replies panel; "/" at the start of the message opens it too. */
  onOpenQuickReplies?: () => void
  /** «Firma de mensajes» of the workspace: AGENT_CHOICE shows the switch. */
  signature?: SignatureMode
  sign?: boolean
  onSignChange?: (sign: boolean) => void
}) {
  const colors = useChatColors()
  const [mode, setMode] = useState<ComposerMode>('reply')
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [sharingContact, setSharingContact] = useState(false)
  const [attachMenu, setAttachMenu] = useState<HTMLElement | null>(null)
  const [accept, setAccept] = useState(ACCEPT_VISUAL)
  const picker = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  const voice = useVoiceRecorder()

  useImperativeHandle(ref, () => ({
    useText: (value: string) => {
      setMode('reply')
      setText(value)
      requestAnimationFrame(() => input.current?.focus())
    },
  }))
  const insertEmoji = (emoji: string) => {
    const element = input.current
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }
  const note = mode === 'note'
  const blocked = !note && replyBlockedReason !== null
  // Sending never blocks the editor: messages go out in order, like WhatsApp.
  const canSend = !blocked && text.trim().length > 0
  const submit = () => {
    if (!canSend) return
    void onSend(text.trim(), mode).then((saved) => {
      if (saved) setText('')
    })
  }
  const pick = (types: string) => {
    setAttachMenu(null)
    setAccept(types)
    // Let React apply the new "accept" before opening the dialog.
    setTimeout(() => picker.current?.click(), 0)
  }
  const choose = (file: File | undefined) => {
    if (!file) return
    const problem = fileProblem(file)
    if (problem) onError(problem)
    else setAttachment(file)
  }
  const sendVoice = async () => {
    const file = await voice.stop()
    if (file) await onSendFile(file, null)
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
      {voice.error && (
        <Alert severity="error" sx={{ mb: 1, py: 0 }}>
          {voice.error}
        </Alert>
      )}
      {voice.recording ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <RoundButton label="Descartar nota de voz" onClick={voice.cancel}>
            <DeleteOutlineRounded />
          </RoundButton>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }} role="status">
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: 'error.main',
                animation: 'pulse 1s infinite',
                '@keyframes pulse': { '50%': { opacity: 0.3 } },
              }}
            />
            <Typography>Grabando {clock(voice.seconds)}</Typography>
          </Stack>
          <RoundButton label="Enviar nota de voz" active onClick={() => void sendVoice()}>
            <SendRounded />
          </RoundButton>
        </Stack>
      ) : (
        <Box sx={{ position: 'relative' }}>
          <Stack
            component="form"
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'flex-end' }}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <RoundButton
              label="Emojis"
              disabled={blocked}
              onClick={(event) => setEmojiAnchor(event.currentTarget)}
            >
              <InsertEmoticonRounded />
            </RoundButton>
            <Popover
              open={!!emojiAnchor}
              anchorEl={emojiAnchor}
              onClose={() => setEmojiAnchor(null)}
              anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <Suspense
                fallback={
                  <Box sx={{ width: 320, height: 380, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                }
              >
                <EmojiPanel dark={colors.dark} onPick={insertEmoji} />
              </Suspense>
            </Popover>
            {!note && onOpenQuickReplies && (
              <RoundButton label="Respuestas rápidas" onClick={onOpenQuickReplies}>
                <BoltRounded />
              </RoundButton>
            )}
            {!note && signature === 'AGENT_CHOICE' && (
              <Tooltip title={sign ? 'Firmando con tu nombre' : 'Firmar con tu nombre'}>
                <IconButton
                  aria-label="Firmar mensajes"
                  aria-pressed={sign}
                  onClick={() => onSignChange?.(!sign)}
                  color={sign ? 'primary' : 'default'}
                >
                  <DrawOutlined />
                </IconButton>
              </Tooltip>
            )}
            {!note && (
              <>
                <RoundButton
                  label="Adjuntar archivo"
                  disabled={blocked}
                  onClick={(event) => setAttachMenu(event.currentTarget)}
                >
                  <AttachFileRounded />
                </RoundButton>
                <Menu
                  anchorEl={attachMenu}
                  open={!!attachMenu}
                  onClose={() => setAttachMenu(null)}
                  anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                >
                  <MenuItem onClick={() => pick(ACCEPT_VISUAL)}>
                    <ListItemIcon>
                      <PhotoLibraryOutlined />
                    </ListItemIcon>
                    <ListItemText>Fotos y videos</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => pick(ACCEPT_DOCUMENT)}>
                    <ListItemIcon>
                      <DescriptionOutlined />
                    </ListItemIcon>
                    <ListItemText>Documento</ListItemText>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setAttachMenu(null)
                      setSharingContact(true)
                    }}
                  >
                    <ListItemIcon>
                      <ContactPhoneOutlined />
                    </ListItemIcon>
                    <ListItemText>Contacto</ListItemText>
                  </MenuItem>
                </Menu>
                <input
                  ref={picker}
                  type="file"
                  hidden
                  accept={accept}
                  aria-label="Elegir archivo"
                  onChange={(event) => {
                    choose(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </>
            )}
            <InputBase
              multiline
              maxRows={6}
              placeholder={note ? 'Escribe una nota para tu equipo' : 'Escribe un mensaje'}
              value={text}
              inputRef={input}
              onChange={(event) => {
                // "/" on an empty message opens the quick replies, as in wasapi.
                if (!note && onOpenQuickReplies && !text && event.target.value === '/') {
                  onOpenQuickReplies()
                  return
                }
                setText(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
              disabled={blocked}
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
            {!note && !text.trim() && voice.supported ? (
              <RoundButton
                label="Grabar nota de voz"
                disabled={blocked}
                onClick={() => void voice.start()}
              >
                <MicRounded />
              </RoundButton>
            ) : (
              <RoundButton
                type="submit"
                label={note ? 'Guardar nota' : 'Enviar respuesta'}
                disabled={!canSend}
                active={canSend}
              >
                <SendRounded />
              </RoundButton>
            )}
          </Stack>
        </Box>
      )}
      {sharingContact && (
        <SendContactDialog
          onClose={() => setSharingContact(false)}
          onSend={(contacts) =>
            void onSendContacts(contacts).then((sent) => {
              if (sent) setSharingContact(false)
            })
          }
        />
      )}
      {attachment && (
        <AttachmentDialog
          file={attachment}
          onClose={() => setAttachment(null)}
          onSend={(caption) =>
            void onSendFile(attachment, caption).then((sent) => {
              if (sent) setAttachment(null)
            })
          }
        />
      )}
    </Box>
  )
}
