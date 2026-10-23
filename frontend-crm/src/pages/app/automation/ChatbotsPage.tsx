import AddOutlined from '@mui/icons-material/AddOutlined'
import ChatOutlined from '@mui/icons-material/ChatOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined'
import WhatsApp from '@mui/icons-material/WhatsApp'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChatbotLinesDialog, ChatbotNameDialog } from '../../../components/chatbots/ChatbotDialogs'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useWorkspaceId } from '../../../components/contacts/useContacts'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import { channelKeys } from '../../../lib/api/channels'
import { chatbotKeys, chatbotsApi, type ChatbotSummary } from '../../../lib/api/chatbots'
import { errorMessage } from '../../../lib/api/errors'

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** "hace 3 días", like wasapi's cards. */
function ago(date: string): string {
  const seconds = (Date.parse(date) - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return relative.format(0, 'minute')
}

/** Automatización → Chatbots: the workspace's bots as cards, as in wasapi. */
export function ChatbotsPage() {
  useDocumentTitle(es.chatbots.title)
  const workspaceId = useWorkspaceId()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const [search, setSearch] = useState('')
  const [naming, setNaming] = useState<ChatbotSummary | 'new' | null>(null)
  const [choosingLines, setChoosingLines] = useState<ChatbotSummary | null>(null)
  const [deleting, setDeleting] = useState<ChatbotSummary | null>(null)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; bot: ChatbotSummary } | null>(null)

  const bots = useQuery({
    queryKey: chatbotKeys.all(workspaceId),
    queryFn: ({ signal }) => chatbotsApi.list(workspaceId, signal),
    enabled: workspaceId !== '',
  })
  const refresh = () => client.invalidateQueries({ queryKey: chatbotKeys.all(workspaceId) })
  const onError = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })

  const toggle = useMutation({
    mutationFn: (bot: ChatbotSummary) =>
      chatbotsApi.update(workspaceId, bot.id, { enabled: !bot.enabled }),
    onSuccess: async (bot) => {
      await refresh()
      enqueueSnackbar(bot.enabled ? es.chatbots.enabledNow : es.chatbots.disabledNow, {
        variant: 'success',
      })
    },
    onError,
  })
  const duplicate = useMutation({
    mutationFn: (bot: ChatbotSummary) => chatbotsApi.duplicate(workspaceId, bot.id),
    onSuccess: async () => {
      await refresh()
      enqueueSnackbar(es.chatbots.duplicated, { variant: 'success' })
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: (bot: ChatbotSummary) => chatbotsApi.remove(workspaceId, bot.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      // Its lines were left without a chatbot.
      void client.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
      enqueueSnackbar(es.chatbots.deleted, { variant: 'success' })
    },
    onError,
  })

  const term = search.trim().toLowerCase()
  const shown = (bots.data ?? []).filter((bot) => bot.name.toLowerCase().includes(term))

  return (
    <Stack spacing={2.5}>
      <PageHeader title={es.chatbots.title} subtitle={es.chatbots.subtitle} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small"
          placeholder={es.chatbots.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: 1 }}
          slotProps={{
            htmlInput: { 'aria-label': es.chatbots.search },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setNaming('new')}>
          {es.chatbots.newBot}
        </Button>
      </Stack>

      {bots.isPending ? (
        <Skeleton variant="rounded" height={200} />
      ) : bots.isError ? (
        <Alert severity="error">{errorMessage(bots.error)}</Alert>
      ) : bots.data.length === 0 ? (
        <Alert severity="info">{es.chatbots.empty}</Alert>
      ) : shown.length === 0 ? (
        <Alert severity="info">{es.chatbots.noMatch}</Alert>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
          }}
        >
          {shown.map((bot) => (
            <Card key={bot.id} variant="outlined" aria-label={bot.name}>
              <CardContent>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
                  <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                    <SmartToyOutlined />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
                      {bot.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {es.chatbots.updatedAgo(ago(bot.updatedAt))}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                  <Tooltip title={bot.enabled ? es.chatbots.active : es.chatbots.inactive}>
                    <Switch
                      checked={bot.enabled}
                      disabled={toggle.isPending}
                      onChange={() => toggle.mutate(bot)}
                      slotProps={{ input: { 'aria-label': `${es.chatbots.active}: ${bot.name}` } }}
                    />
                  </Tooltip>
                  <Chip
                    size="small"
                    color={bot.enabled ? 'success' : 'default'}
                    label={bot.enabled ? es.chatbots.active : es.chatbots.inactive}
                  />
                  {bot.errors > 0 && (
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      label={es.chatbots.errors(bot.errors)}
                    />
                  )}
                </Stack>
                <Stack
                  direction="row"
                  useFlexGap
                  spacing={1}
                  sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <WhatsApp fontSize="small" sx={{ color: 'text.secondary' }} />
                  {bot.lines.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {es.chatbots.unassigned}
                    </Typography>
                  ) : (
                    bot.lines.map((line) => <Chip key={line.id} size="small" label={line.name} />)
                  )}
                </Stack>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditOutlined />}
                  component={Link}
                  to={`/automation/chatbots/${bot.id}`}
                >
                  {es.chatbots.edit}
                </Button>
                <Button
                  size="small"
                  startIcon={<ChatOutlined />}
                  onClick={() => void navigate(`/automation/chatbots/${bot.id}?probar=1`)}
                >
                  {es.chatbots.test}
                </Button>
                <Box sx={{ flex: 1 }} />
                <IconButton
                  aria-label={es.chatbots.more(bot.name)}
                  aria-haspopup="menu"
                  onClick={(event) => setMenu({ anchor: event.currentTarget, bot })}
                >
                  <MoreVertRounded />
                </IconButton>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {[
          { label: es.chatbots.assignLines, run: (bot: ChatbotSummary) => setChoosingLines(bot) },
          { label: es.chatbots.duplicate, run: (bot: ChatbotSummary) => duplicate.mutate(bot) },
          { label: es.chatbots.rename, run: (bot: ChatbotSummary) => setNaming(bot) },
          { label: es.chatbots.delete, run: (bot: ChatbotSummary) => setDeleting(bot) },
        ].map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              if (menu) item.run(menu.bot)
              setMenu(null)
            }}
          >
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {naming && (
        <ChatbotNameDialog
          initial={naming === 'new' ? null : naming.name}
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            if (naming === 'new') {
              const created = await chatbotsApi.create(workspaceId, name)
              await refresh()
              enqueueSnackbar(es.chatbots.created, { variant: 'success' })
              void navigate(`/automation/chatbots/${created.id}`)
            } else {
              await chatbotsApi.update(workspaceId, naming.id, { name })
              await refresh()
              enqueueSnackbar(es.chatbots.saved, { variant: 'success' })
            }
          }}
        />
      )}
      {choosingLines && (
        <ChatbotLinesDialog
          workspaceId={workspaceId}
          chatbot={choosingLines}
          chatbots={bots.data ?? []}
          onClose={() => setChoosingLines(null)}
          onSubmit={async (lineIds, takeOver) => {
            await chatbotsApi.setLines(workspaceId, choosingLines.id, lineIds, takeOver)
            await refresh()
            void client.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
            enqueueSnackbar(es.chatbots.linesSaved, { variant: 'success' })
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={es.chatbots.delete}
        confirmLabel={es.chatbots.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && es.chatbots.confirmDelete(deleting.name)}
      </ConfirmDialog>
    </Stack>
  )
}
