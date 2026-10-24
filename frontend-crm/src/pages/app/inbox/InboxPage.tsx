import ChatOutlined from '@mui/icons-material/ChatOutlined'
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined'
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded'
import ScheduleRounded from '@mui/icons-material/ScheduleRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import TaskAltRounded from '@mui/icons-material/TaskAltRounded'
import {
  Alert,
  Badge,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useMe } from '../../../auth/useMe'
import { usePermissions } from '../../../auth/usePermissions'
import { useChatColors } from '../../../components/inbox/chat-colors'
import { ConversationFilters } from '../../../components/inbox/ConversationFilters'
import {
  activeFilters,
  NO_FILTERS,
  toQuery,
  type ListFilters,
} from '../../../components/inbox/list-filters'
import { ConversationListItem } from '../../../components/inbox/ConversationList'
import { ConversationPanel } from '../../../components/inbox/ConversationPanel'
import { InboxToolbar } from '../../../components/inbox/InboxToolbar'
import { useInboxCounts } from '../../../components/inbox/useInboxCounts'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { useFillHeight } from '../../../hooks/useFillHeight'
import { useWhenVisible } from '../../../hooks/useWhenVisible'
import { contactKeys, contactsApi } from '../../../lib/api/contacts'
import { errorMessage } from '../../../lib/api/errors'
import { inboxApi, inboxKeys, type InboxFilter } from '../../../lib/api/inbox'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

export function InboxPage() {
  useDocumentTitle('Bandeja de mensajes')
  const { active } = useActiveWorkspace()
  return <WorkspaceInbox key={active?.id} workspaceId={active?.id ?? ''} />
}

type Status = Exclude<InboxFilter['status'], 'ALL'>

const TEAM_VIEW_KEY = 'inbox.teamView'

/** "Mis conversaciones y las de mis agentes": on unless this browser turned it off. */
function readTeamView(): boolean {
  try {
    return localStorage.getItem(TEAM_VIEW_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveTeamView(value: boolean) {
  try {
    localStorage.setItem(TEAM_VIEW_KEY, String(value))
  } catch {
    // Private mode: the choice lasts until the page is reloaded.
  }
}

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}
const isFullscreen = () => !!document.fullscreenElement

/** Tab of a status with its icon and counter (red on «Abierto», as in wasapi). */
function statusTab(icon: ReactNode, label: string, count: number | undefined, alert: boolean) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
      {icon}
      <span>{label}</span>
      {!!count && (
        <Chip
          size="small"
          label={count > 99 ? '99+' : count}
          color={alert ? 'error' : 'default'}
          sx={{ height: 20, fontSize: 12, fontWeight: 700 }}
        />
      )}
    </Stack>
  )
}

function WorkspaceInbox({ workspaceId }: { workspaceId: string }) {
  const { has } = usePermissions()
  const client = useQueryClient()
  const colors = useChatColors()
  const meId = useMe().data?.id
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>()
  const [params, setParams] = useSearchParams()
  const contactId = params.get('contactId') ?? undefined
  const selected = params.get('conversation') ?? ''
  const [teamView, setTeamView] = useState(readTeamView)
  const [status, setStatus] = useState<Status>('OPEN')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Contact details beside the chat: hidden until asked for, kept across chats.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false)
  const canFilterAgents = has('conversations.view_all')

  const filter: InboxFilter = {
    // The chats of one contact (from Contactos) show every status.
    view: contactId || teamView ? 'all' : 'mine',
    status: contactId ? 'ALL' : status,
    search: useDeferredValue(search),
    contactId,
    ...toQuery(canFilterAgents ? filters : { ...filters, assigneeIds: [] }),
  }
  const counts = useInboxCounts()
  const tabCounts = teamView
    ? { OPEN: counts.data?.all, ON_HOLD: counts.data?.onHold, CLOSED: counts.data?.closedUnread }
    : {
        OPEN: counts.data?.mine,
        ON_HOLD: counts.data?.mineOnHold,
        CLOSED: counts.data?.mineClosedUnread,
      }
  const options = useQuery({
    queryKey: inboxKeys.options(workspaceId),
    queryFn: ({ signal }) => inboxApi.options(workspaceId, signal),
    enabled: !!workspaceId,
  })
  const tags = useQuery({
    queryKey: contactKeys.tags(workspaceId),
    queryFn: () => contactsApi.tags(workspaceId),
    enabled: !!workspaceId && has('contacts.read'),
  })
  const tagsById = new Map((tags.data ?? []).map((tag) => [tag.id, tag]))
  const lineColors = new Map((options.data?.lines ?? []).map((line) => [line.id, line.color]))
  const conversations = useInfiniteQuery({
    queryKey: [...inboxKeys.all(workspaceId), 'list', filter],
    queryFn: ({ pageParam, signal }) => inboxApi.list(workspaceId, filter, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!workspaceId,
  })
  const rows = [
    ...new Map(
      conversations.data?.pages
        .flatMap((page) => page.items)
        .map((conversation) => [conversation.id, conversation]),
    ).values(),
  ]
  const moreChats = useWhenVisible<HTMLDivElement>(() => {
    if (conversations.hasNextPage && !conversations.isFetchingNextPage) {
      void conversations.fetchNextPage()
    }
  }, !!conversations.hasNextPage)
  const select = (id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('conversation', id)
    else next.delete('conversation')
    setParams(next, { replace: true })
  }
  const sync = () => {
    setSyncing(true)
    void client
      .invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      .finally(() => setSyncing(false))
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void fillRef.current?.requestFullscreen?.()
  }
  const filtered = activeFilters(filters)
  // Agents only see the chats of their lines: without lines, nothing arrives.
  const noLines = options.data?.viewAll === false && options.data.myLineIds?.length === 0

  return (
    <Paper
      ref={fillRef}
      variant="outlined"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '380px minmax(0, 1fr)', xl: '420px minmax(0, 1fr)' },
        // The page fills the screen below the top bar, like a chat app.
        height: fullscreen ? '100dvh' : (fillHeight ?? 'calc(100dvh - 128px)'),
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: { xs: selected ? 'none' : 'flex', md: 'flex' },
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <InboxToolbar
          options={options.data}
          teamView={teamView}
          onTeamViewChange={(value) => {
            setTeamView(value)
            saveTeamView(value)
          }}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          syncing={syncing}
          onSync={sync}
        />
        {filtersOpen ? (
          <ConversationFilters
            applied={filters}
            onApply={(next) => {
              setFilters(next)
              setFiltersOpen(false)
            }}
            onClose={() => setFiltersOpen(false)}
            tags={tags.data ?? []}
            members={options.data?.members ?? []}
            canFilterAgents={canFilterAgents}
            lines={options.data?.lines ?? []}
          />
        ) : (
          <>
            <Stack spacing={1} sx={{ px: 1.5, pt: 1.25, pb: contactId ? 1 : 0.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Tooltip title="Filtros de conversaciones">
                  <IconButton
                    aria-label={filtered ? `Filtros (${filtered} activos)` : 'Filtros'}
                    onClick={() => setFiltersOpen(true)}
                    sx={{ color: filtered ? colors.agent : 'text.secondary' }}
                  >
                    <Badge
                      variant="dot"
                      invisible={!filtered}
                      sx={{ '& .MuiBadge-badge': { bgcolor: colors.unread } }}
                    >
                      <FilterAltOutlined />
                    </Badge>
                  </IconButton>
                </Tooltip>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Buscar por nombre o teléfono"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  slotProps={{
                    htmlInput: { 'aria-label': 'Buscar nombre o teléfono' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRounded fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>
              {contactId && (
                <Chip
                  label="Conversaciones del contacto"
                  onDelete={() => setParams({})}
                  sx={{ alignSelf: 'flex-start' }}
                />
              )}
            </Stack>
            {!contactId && (
              <Tabs
                value={status}
                onChange={(_, value: Status) => setStatus(value)}
                variant="fullWidth"
                aria-label="Estado de las conversaciones"
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  minHeight: 44,
                  '& .MuiTab-root': { minHeight: 44, px: 1, textTransform: 'none' },
                }}
              >
                <Tab
                  value="OPEN"
                  aria-label="Abierto"
                  label={statusTab(
                    <MailOutlineRounded fontSize="small" />,
                    'Abierto',
                    tabCounts.OPEN,
                    true,
                  )}
                />
                <Tab
                  value="ON_HOLD"
                  aria-label="En espera"
                  label={statusTab(
                    <ScheduleRounded fontSize="small" />,
                    'En espera',
                    tabCounts.ON_HOLD,
                    false,
                  )}
                />
                <Tab
                  value="CLOSED"
                  aria-label="Cerrado"
                  label={statusTab(
                    <TaskAltRounded fontSize="small" />,
                    'Cerrado',
                    tabCounts.CLOSED,
                    false,
                  )}
                />
              </Tabs>
            )}
            {conversations.isFetching && <LinearProgress />}
            {conversations.error && (
              <Alert severity="error">{errorMessage(conversations.error)}</Alert>
            )}
            <List disablePadding sx={{ flex: 1, overflowY: 'auto' }} aria-label="Lista de chats">
              {rows.map((conversation) => (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  selected={selected === conversation.id}
                  onSelect={() => select(conversation.id)}
                  meId={meId}
                  tags={tagsById}
                  lineColor={lineColors.get(conversation.lineId)}
                />
              ))}
              {noLines ? (
                <Alert severity="warning" sx={{ m: 1.5 }}>
                  Aún no tienes números asignados. Pide al propietario o a un administrador que te
                  asigne una línea en Equipo → Agentes.
                </Alert>
              ) : (
                !conversations.isPending &&
                !conversations.error &&
                rows.length === 0 && (
                  <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                    {filtered
                      ? 'Ningún chat coincide con los filtros.'
                      : 'No hay conversaciones aquí.'}
                  </Typography>
                )
              )}
              {/* More chats load on their own when scrolling to the end. */}
              <Box ref={moreChats} sx={{ height: 1 }} />
              {conversations.isFetchingNextPage && <LinearProgress />}
            </List>
          </>
        )}
      </Box>
      <Box
        sx={{
          display: { xs: selected ? 'block' : 'none', md: 'block' },
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {selected ? (
          <ConversationPanel
            key={`${workspaceId}:${selected}`}
            workspaceId={workspaceId}
            id={selected}
            onBack={() => select('')}
            detailsOpen={detailsOpen}
            onDetailsChange={setDetailsOpen}
          />
        ) : (
          <Stack
            spacing={2}
            sx={{
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: colors.wallpaper,
              p: 4,
              textAlign: 'center',
            }}
          >
            <ChatOutlined sx={{ fontSize: 64, color: 'text.disabled' }} />
            <Typography variant="h6">Bandeja de mensajes</Typography>
            <Typography color="text.secondary">
              Selecciona una conversación para comenzar.
            </Typography>
          </Stack>
        )}
      </Box>
    </Paper>
  )
}
