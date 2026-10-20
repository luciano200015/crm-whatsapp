import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { useSearchParams } from 'react-router'
import { usePermissions } from '../../../auth/usePermissions'
import { ConversationPanel } from '../../../components/inbox/ConversationPanel'
import { useInboxCounts } from '../../../components/inbox/useInboxCounts'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { errorMessage } from '../../../lib/api/errors'
import { inboxApi, inboxKeys, type InboxFilter } from '../../../lib/api/inbox'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

export function InboxPage() {
  useDocumentTitle('Bandeja de mensajes')
  const { active } = useActiveWorkspace()
  return <WorkspaceInbox key={active?.id} workspaceId={active?.id ?? ''} />
}

function WorkspaceInbox({ workspaceId }: { workspaceId: string }) {
  const { has } = usePermissions()
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
    <Stack spacing={2}>
      <PageHeader
        title="Bandeja de mensajes"
        subtitle="Atiende a tus clientes y coordina las conversaciones de tu equipo."
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' },
          gap: 2,
          minHeight: 650,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            display: { xs: selected ? 'none' : 'block', md: 'block' },
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Stack spacing={1.5} sx={{ p: 2 }}>
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
              label="Buscar nombre o teléfono"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                label="Estado"
                value={status}
                onChange={(event) => setStatus(event.target.value as InboxFilter['status'])}
                fullWidth
              >
                <MenuItem value="OPEN">Abiertos</MenuItem>
                <MenuItem value="CLOSED">Cerrados</MenuItem>
              </TextField>
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
              variant="scrollable"
              aria-label="Conversaciones"
            >
              <Tab value="mine" label={`Mis chats (${counts.data?.mine ?? 0})`} />
              <Tab value="unassigned" label={`Sin asignar (${counts.data?.unassigned ?? 0})`} />
              {has('conversations.view_all') && (
                <Tab value="all" label={`Todos (${counts.data?.all ?? 0})`} />
              )}
            </Tabs>
          )}
          {conversations.isFetching && <LinearProgress />}
          {conversations.error && (
            <Alert severity="error">{errorMessage(conversations.error)}</Alert>
          )}
          <List sx={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {rows.map((conversation) => (
              <ListItemButton
                key={conversation.id}
                selected={selected === conversation.id}
                onClick={() => select(conversation.id)}
                sx={{ gap: 1.5, alignItems: 'flex-start', py: 2 }}
              >
                <Badge badgeContent={conversation.unreadCount} color="primary">
                  <Avatar>
                    {(conversation.contact.name ?? conversation.contact.phone).slice(0, 1)}
                  </Avatar>
                </Badge>
                <ListItemText
                  primary={conversation.contact.name ?? conversation.contact.phone}
                  secondary={`${conversation.lineName ?? 'Línea eliminada'} · ${conversation.lastMessage?.text ?? 'Archivo recibido'}`}
                  slotProps={{
                    primary: {
                      noWrap: true,
                      sx: { fontWeight: conversation.unreadCount ? 700 : 500 },
                    },
                    secondary: { noWrap: true },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
          {!conversations.isPending && !conversations.error && rows.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 3 }}>
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
        </Paper>
        {selected ? (
          <ConversationPanel
            key={`${workspaceId}:${selected}`}
            workspaceId={workspaceId}
            id={selected}
            onBack={() => select('')}
          />
        ) : (
          <Paper
            variant="outlined"
            sx={{ display: { xs: 'none', md: 'grid' }, placeItems: 'center', p: 4 }}
          >
            <Typography color="text.secondary">
              Selecciona una conversación para comenzar.
            </Typography>
          </Paper>
        )}
      </Box>
    </Stack>
  )
}
