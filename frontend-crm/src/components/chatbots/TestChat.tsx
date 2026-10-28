import CloseRounded from '@mui/icons-material/CloseRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import ReplayRounded from '@mui/icons-material/ReplayRounded'
import SendRounded from '@mui/icons-material/SendRounded'
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { es } from '../../i18n/es'
import {
  chatbotsApi,
  type BotAction,
  type BotVariable,
  type ChatbotSettings,
  type FlowGraph,
  type InteractiveContent,
  type SimulationSession,
} from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'
import { funnelKeys, type Funnel } from '../../lib/api/funnels'
import type { TagSummary } from '../../lib/api/types'
import { useChatColors } from '../inbox/chat-colors'
import type { Member } from './NodeEditor'

type Entry =
  | { id: number; from: 'customer'; text: string }
  | { id: number; from: 'bot'; action: BotAction }
  | { id: number; from: 'system'; text: string }

const tt = es.chatbots.tester

/** What the bot did, told in words (tags, funnel, transfer, status). */
function describe(
  action: BotAction,
  tags: Map<string, TagSummary>,
  members: Member[],
  funnelOf: (id: string) => Funnel | undefined,
): string {
  const names = (ids: string[]) => ids.map((id) => tags.get(id)?.name ?? '?').join(', ')
  if (action.kind === 'tags') return tt.tags(names(action.add), names(action.remove))
  if (action.kind === 'funnel') {
    const funnel = funnelOf(action.funnelId)
    const stage = funnel?.stages.find((item) => item.id === action.stageId)
    return tt.funnel(funnel?.name ?? '?', stage?.name ?? '?')
  }
  if (action.kind === 'transfer') {
    const member = members.find((m) => m.membershipId === action.membershipId)
    const to =
      action.to === 'member'
        ? `a ${member?.name ?? 'un agente'}`
        : action.to === 'auto'
          ? 'a los agentes de la línea, por turnos'
          : 'a la cola sin asignar'
    return tt.transfer(to, action.pause === 'permanent' ? 'de forma permanente' : 'por 24 horas')
  }
  if (action.kind === 'status') return tt.status(es.chatbots.node.statuses[action.status])
  if (action.kind === 'contact')
    return tt.contact(action.field === 'name' ? 'el nombre' : 'el email', action.value)
  return ''
}

/** Who would get the chat, as {{agente}} reads in the handover message. */
function agentName(action: Extract<BotAction, { kind: 'transfer' }>, members: Member[]): string {
  if (action.to === 'member')
    return members.find((m) => m.membershipId === action.membershipId)?.name ?? 'un agente'
  return action.to === 'auto' ? 'el agente de turno' : 'un agente'
}

function InteractiveBubble({
  content,
  onChoose,
}: {
  content: InteractiveContent
  onChoose: (id: string, title: string) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <Stack spacing={0.75}>
      {content.header && <Typography sx={{ fontWeight: 700 }}>{content.header}</Typography>}
      <Typography sx={{ whiteSpace: 'pre-wrap' }}>{content.body}</Typography>
      {content.footer && (
        <Typography variant="caption" color="text.secondary">
          {content.footer}
        </Typography>
      )}
      {content.buttons?.map((button) => (
        <Button
          key={button.id}
          size="small"
          variant="outlined"
          onClick={() => onChoose(button.id, button.title)}
        >
          {button.title}
        </Button>
      ))}
      {content.list && (
        <>
          <Button
            size="small"
            variant="outlined"
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            {content.list.button || tt.openList}
          </Button>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            {content.list.sections.flatMap((section) =>
              section.rows.map((row) => (
                <MenuItem
                  key={row.id}
                  onClick={() => {
                    setAnchor(null)
                    onChoose(row.id, row.title)
                  }}
                >
                  <Stack>
                    <Typography variant="body2">{row.title}</Typography>
                    {row.description && (
                      <Typography variant="caption" color="text.secondary">
                        {row.description}
                      </Typography>
                    )}
                  </Stack>
                </MenuItem>
              )),
            )}
          </Menu>
        </>
      )}
      {content.url && (
        <Button
          size="small"
          variant="outlined"
          endIcon={<OpenInNewRounded />}
          href={content.url.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content.url.text}
        </Button>
      )}
    </Stack>
  )
}

/**
 * "Probar chatbot": a pretend customer chats with the flow on screen (saved
 * or not). Nothing is sent to WhatsApp and nothing changes.
 */
export function TestChat({
  workspaceId,
  graph,
  settings,
  variables,
  tags,
  members,
  onClose,
}: {
  workspaceId: string
  graph: () => FlowGraph
  /** As in "Configuración" (saved): what to say when nothing fits, words for the menu. */
  settings: Pick<ChatbotSettings, 'fallbackText' | 'restartKeywords'>
  variables: BotVariable[]
  tags: TagSummary[]
  members: Member[]
  onClose: () => void
}) {
  const colors = useChatColors()
  const [entries, setEntries] = useState<Entry[]>([])
  const [session, setSession] = useState<SimulationSession | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)
  const end = useRef<HTMLDivElement>(null)
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
  // The cards of the canvas already loaded the funnels their nodes use.
  const client = useQueryClient()
  const funnelOf = (id: string) => client.getQueryData<Funnel>(funnelKeys.detail(workspaceId, id))
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [entries.length])

  const say = async (message: string, replyId: string | null = null) => {
    if (!message.trim() || busy) return
    const next = () => ++counter.current
    setEntries((current) => [...current, { id: next(), from: 'customer', text: message }])
    setText('')
    setBusy(true)
    setError(null)
    try {
      const result = await chatbotsApi.simulate(workspaceId, {
        graph: graph(),
        session,
        text: message,
        replyId,
        contactName: 'Cliente de prueba',
        fallbackText: settings.fallbackText,
        restartKeywords: settings.restartKeywords,
        variables,
      })
      // The flow reached a card with nothing after it: the chat stays open.
      const finished = result.session?.nodeId === null && session?.nodeId !== null
      setSession(result.session)
      setEntries((current) => [
        ...current,
        ...result.actions.flatMap((action): Entry[] =>
          action.kind === 'send'
            ? [{ id: next(), from: 'bot', action }]
            : [
                {
                  id: next(),
                  from: 'system',
                  text: describe(action, tagsById, members, funnelOf),
                },
                // What the customer reads after the handover.
                ...(action.kind === 'transfer' && action.message
                  ? [
                      {
                        id: next(),
                        from: 'bot' as const,
                        action: {
                          kind: 'send' as const,
                          message: {
                            kind: 'text' as const,
                            text: action.message
                              .split('{{agente}}')
                              .join(agentName(action, members)),
                          },
                        },
                      },
                    ]
                  : []),
              ],
        ),
        ...(result.session
          ? finished
            ? [{ id: next(), from: 'system' as const, text: tt.finished }]
            : []
          : [{ id: next(), from: 'system' as const, text: tt.ended }]),
      ])
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack sx={{ height: '100%' }} role="dialog" aria-label={tt.title}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <SmartToyOutlined color="primary" />
        <Typography sx={{ fontWeight: 700, flex: 1 }}>{tt.title}</Typography>
        <Tooltip title={tt.restart}>
          <IconButton
            aria-label={tt.restart}
            onClick={() => {
              setEntries([])
              setSession(null)
              setError(null)
            }}
          >
            <ReplayRounded />
          </IconButton>
        </Tooltip>
        <IconButton aria-label={es.chatbots.editor.close} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>
      <Stack
        spacing={1}
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          bgcolor: colors.wallpaper,
          backgroundImage: `radial-gradient(${colors.pattern} 1px, transparent 1px)`,
          backgroundSize: '18px 18px',
        }}
        aria-label="Conversación de prueba"
      >
        <Alert severity="info" sx={{ fontSize: 13 }}>
          {entries.length === 0 ? tt.start : tt.help}
        </Alert>
        {entries.map((entry) => {
          if (entry.from === 'system')
            return (
              <Typography
                key={entry.id}
                variant="caption"
                sx={{
                  alignSelf: 'center',
                  textAlign: 'center',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  color: 'text.secondary',
                }}
              >
                {entry.text}
              </Typography>
            )
          const mine = entry.from === 'customer'
          return (
            <Box
              key={entry.id}
              sx={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                px: 1.5,
                py: 1,
                borderRadius: 2,
                bgcolor: mine ? colors.outgoing : colors.incoming,
                boxShadow: 1,
              }}
            >
              {entry.from === 'customer' ? (
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{entry.text}</Typography>
              ) : entry.action.kind === 'send' && entry.action.message.kind === 'interactive' ? (
                <InteractiveBubble
                  content={entry.action.message.content}
                  onChoose={(id, title) => void say(title, id)}
                />
              ) : entry.action.kind === 'send' && entry.action.message.kind === 'media' ? (
                <Typography>
                  {tt.file(entry.action.message.media.filename)}
                  {entry.action.message.caption && (
                    <Box component="span" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                      {entry.action.message.caption}
                    </Box>
                  )}
                </Typography>
              ) : entry.action.kind === 'send' && entry.action.message.kind === 'text' ? (
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{entry.action.message.text}</Typography>
              ) : null}
            </Box>
          )
        })}
        {error && <Alert severity="error">{error}</Alert>}
        <div ref={end} />
      </Stack>
      <Stack
        component="form"
        direction="row"
        spacing={1}
        sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}
        onSubmit={(event) => {
          event.preventDefault()
          void say(text)
        }}
      >
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder={tt.placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': tt.placeholder, maxLength: 4096 } }}
        />
        <IconButton
          type="submit"
          color="primary"
          aria-label={tt.send}
          disabled={busy || !text.trim()}
        >
          <SendRounded />
        </IconButton>
      </Stack>
    </Stack>
  )
}
