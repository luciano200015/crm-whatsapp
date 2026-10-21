import ChatOutlined from '@mui/icons-material/ChatOutlined'
import SearchRounded from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  LinearProgress,
  List,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { usePermissions } from '../../../auth/usePermissions'
import { useChatColors } from '../../../components/inbox/chat-colors'
import { ConversationListItem } from '../../../components/inbox/ConversationList'
import { ConversationPanel } from '../../../components/inbox/ConversationPanel'
import { useInboxCounts } from '../../../components/inbox/useInboxCounts'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { useFillHeight } from '../../../hooks/useFillHeight'
import { errorMessage } from '../../../lib/api/errors'
import { inboxApi, inboxKeys, type InboxFilter } from '../../../lib/api/inbox'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

export function InboxPage() {
  useDocumentTitle('Bandeja de mensajes')
  const { active } = useActiveWorkspace()
  return <WorkspaceInbox key={active?.id} workspaceId={active?.id ?? ''} />
}

/** Tab label with its counter, e.g. "Mis chats 3". */
function counted(label: string, count: number | undefined): ReactNode {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span>{label}</span>
      {!!count && <Chip size="small" label={count > 99 ? '99+' : count} sx={{ height: 20 }} />}
    </Stack>
  )
}

function WorkspaceInbox({ workspaceId }: { workspaceId: string }) {
  const { has } = usePermissions()
  const colors = useChatColors()
  const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>()
  const [params, setParams] = useSearchParams()
  const contactId = params.get('contactId') ?? undefined
  const selected = params.get('conversation') ?? ''
  const [view, setView] = useState<InboxFilter['view']>(contactId ? 'all' : 'mine')
  const [status, setStatus] = useState<InboxFilter['status']>('OPEN')
  const [search, setSearch] = useState('')
  const [lineId, setLineId] = useState('')
  const filter: InboxFilter = {
    view: has('conversations.view_all') || contactId ? view : view === 'all' ? 'mine' : view,
    status,
    search: useDeferredValue(search),
    lineId: lineId || undefined,
    contactId,
  }
  const counts = useInboxCounts()
  const options = useQuery({
    queryKey: inboxKeys.options(workspaceId),
    queryFn: ({ signal }) => inboxApi.options(workspaceId, signal),
    enabled: !!workspaceId,
  })
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
  const select = (id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('conversation', id)
    else next.delete('conversation')
    setParams(next, { replace: true })
  }
  return (
    <Paper
      ref={fillRef}
      variant="outlined"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '360px minmax(0, 1fr)', xl: '400px minmax(0, 1fr)' },
        // The page fills the screen below the top bar, like a chat app.
        height: fillHeight ?? 'calc(100dvh - 128px)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: { xs: selected ? 'none' : 'flex', md: 'flex' },
          flexDirection: 'column',
          minWidth: 0,
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Stack spacing={1.25} sx={{ p: 1.5 }}>
          <Typography variant="h6" component="h1">
            Chats
          </Typography>
          {contactId && (
            <Chip
              label="Conversaciones del contacto"
              onDelete={() => {
                setParams({})
                setView('mine')
              }}
            />
          )}
          <TextField
            size="small"
            placeholder="Buscar nombre o teléfono"
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
                sx: { borderRadius: 3, bgcolor: 'action.hover' },
              },
            }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={status}
              aria-label="Estado"
              onChange={(_, value: InboxFilter['status'] | null) => {
                if (value) setStatus(value)
              }}
              sx={{ flexShrink: 0 }}
            >
              <ToggleButton value="OPEN">Abiertos</ToggleButton>
              <ToggleButton value="CLOSED">Cerrados</ToggleButton>
              <ToggleButton value="ALL">Todos</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              size="small"
              label="Línea"
              value={lineId}
              onChange={(event) => setLineId(event.target.value)}
              fullWidth
            >
              <MenuItem value="">Todas</MenuItem>
              {options.data?.lines.map((line) => (
                <MenuItem key={line.id} value={line.id}>
                  {line.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>
        {!contactId && (
          <Tabs
            value={filter.view}
            onChange={(_, value: InboxFilter['view']) => setView(value)}
            variant="fullWidth"
            aria-label="Conversaciones"
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
          >
            <Tab
              value="mine"
              label={counted('Mis chats', counts.data?.mine)}
              sx={{ minHeight: 40 }}
            />
            <Tab
              value="unassigned"
              label={counted('Sin asignar', counts.data?.unassigned)}
              sx={{ minHeight: 40 }}
            />
            {has('conversations.view_all') && (
              <Tab value="all" label={counted('Todos', counts.data?.all)} sx={{ minHeight: 40 }} />
            )}
          </Tabs>
        )}
        {conversations.isFetching && <LinearProgress />}
        {conversations.error && <Alert severity="error">{errorMessage(conversations.error)}</Alert>}
        <List disablePadding sx={{ flex: 1, overflowY: 'auto' }} aria-label="Lista de chats">
          {rows.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              selected={selected === conversation.id}
              onSelect={() => select(conversation.id)}
            />
          ))}
          {!conversations.isPending && !conversations.error && rows.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No hay conversaciones en esta vista.
            </Typography>
          )}
          {conversations.hasNextPage && (
            <Button
              fullWidth
              disabled={conversations.isFetchingNextPage}
              onClick={() => void conversations.fetchNextPage()}
            >
              Cargar más conversaciones
            </Button>
          )}
        </List>
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
