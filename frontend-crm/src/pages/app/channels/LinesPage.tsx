import AddOutlined from '@mui/icons-material/AddOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import WhatsApp from '@mui/icons-material/WhatsApp'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { Can } from '../../../auth/permissions'
import { usePermissions } from '../../../auth/usePermissions'
import { useCatalog } from '../../../components/billing/useCatalog'
import { ColorPicker } from '../../../components/ColorPicker'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { LineAgentsDialog, LineDialog } from '../../../components/channels/LineDialogs'
import { useWorkspaceId } from '../../../components/contacts/useContacts'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import { channelKeys, channelsApi } from '../../../lib/api/channels'
import { errorMessage } from '../../../lib/api/errors'
import { teamApi } from '../../../lib/api/team'
import type { Line, LineChanges, LineRequest, LineStatus } from '../../../lib/api/types'
import { formatDate } from '../../../lib/billing'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

const STATUS_COLOR: Record<LineStatus, 'default' | 'success' | 'warning' | 'error'> = {
  PENDING: 'warning',
  CONNECTED: 'success',
  ERROR: 'error',
  DISABLED: 'default',
}

/** Canales → Líneas. The route requires channels.read. */
export function LinesPage() {
  useDocumentTitle(es.lines.title)
  const workspaceId = useWorkspaceId()
  const { active } = useActiveWorkspace()
  const { has } = usePermissions()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()

  const lines = useQuery({
    queryKey: channelKeys.lines(workspaceId),
    queryFn: () => channelsApi.lines(workspaceId),
    enabled: workspaceId !== '',
  })
  // Active members to pick agents from (only needed by managers).
  const members = useQuery({
    queryKey: ['team', workspaceId, 'members', { status: 'ACTIVE' }],
    queryFn: () => teamApi.members(workspaceId, { status: 'ACTIVE' }),
    enabled: workspaceId !== '' && has('channels.manage') && has('members.read'),
  })

  const [editing, setEditing] = useState<Line | 'new' | null>(null)
  const [choosingAgents, setChoosingAgents] = useState<Line | null>(null)
  const [deleting, setDeleting] = useState<Line | null>(null)

  const plan = catalog.data?.plans.find((p) => p.code === active?.plan?.code)
  const limitValue = plan?.features.find((f) => f.key === 'limits.whatsapp_lines')?.value
  const limit = typeof limitValue === 'number' ? limitValue : null
  const count = lines.data?.length ?? 0
  const limitReached = limit !== null && count >= limit

  const refresh = () => queryClient.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
  const onError = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })

  const save = async (values: LineChanges) => {
    if (editing && editing !== 'new') {
      await channelsApi.update(workspaceId, editing.id, values)
      enqueueSnackbar(es.lines.updated, { variant: 'success' })
    } else {
      await channelsApi.create(workspaceId, values as LineRequest)
      enqueueSnackbar(es.lines.created, { variant: 'success' })
    }
    await refresh()
  }

  const test = useMutation({
    mutationFn: (line: Line) => channelsApi.test(workspaceId, line.id),
    onSuccess: async (line) => {
      await refresh()
      enqueueSnackbar(line.status === 'ERROR' ? es.lines.testFailed : es.lines.tested, {
        variant: line.status === 'ERROR' ? 'error' : 'success',
      })
    },
    onError,
  })
  const toggle = useMutation({
    mutationFn: ({ line, changes }: { line: Line; changes: LineChanges }) =>
      channelsApi.update(workspaceId, line.id, changes),
    onSuccess: async () => {
      await refresh()
      enqueueSnackbar(es.lines.updated, { variant: 'success' })
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: (line: Line) => channelsApi.remove(workspaceId, line.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(es.lines.deleted, { variant: 'success' })
    },
    onError,
  })

  return (
    <Stack spacing={2.5}>
      <PageHeader title={es.lines.title} subtitle={es.lines.subtitle} />

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
      >
        {lines.data && <Chip variant="outlined" label={es.lines.usage(count, limit)} />}
        <Can anyOf={['channels.manage']}>
          <Tooltip
            title={
              limitReached
                ? es.apiErrors.LINE_LIMIT_REACHED({ plan: plan?.name, limit, usage: count })
                : ''
            }
          >
            <span>
              <Button
                variant="contained"
                startIcon={<AddOutlined />}
                disabled={limitReached}
                onClick={() => setEditing('new')}
              >
                {es.lines.newLine}
              </Button>
            </span>
          </Tooltip>
        </Can>
      </Stack>

      {lines.isPending ? (
        <Skeleton variant="rounded" height={220} />
      ) : lines.isError ? (
        <Alert severity="error">{errorMessage(lines.error)}</Alert>
      ) : lines.data.length === 0 ? (
        <Alert severity="info">{es.lines.empty}</Alert>
      ) : (
        lines.data.map((line) => (
          <Card key={line.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
                <WhatsApp sx={{ color: line.color ?? '#25D366' }} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
                    {line.name}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {[line.displayPhone, line.verifiedName].filter(Boolean).join(' · ') ||
                      `${es.lines.phoneNumberId} ${line.phoneNumberId}`}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={STATUS_COLOR[line.status]}
                  label={es.lines.status[line.status]}
                />
              </Stack>

              {line.status === 'ERROR' && line.lastError && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  {line.lastError}
                </Alert>
              )}

              <Stack spacing={0.5} sx={{ color: 'text.secondary' }}>
                <Typography variant="body2">
                  {es.lines.phoneNumberId}: {line.phoneNumberId} ·{' '}
                  {es.lines.token(line.accessTokenLast4)}
                </Typography>
                <TokenExpiry expiresAt={line.accessTokenExpiresAt} />
                <Typography variant="body2">
                  {line.lastWebhookAt
                    ? es.lines.lastWebhook(formatDate(line.lastWebhookAt))
                    : es.lines.noWebhookYet}
                </Typography>
              </Stack>

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
                {es.lines.agents}
              </Typography>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                {line.agents.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {es.lines.noAgents}
                  </Typography>
                ) : (
                  line.agents.map((agent) => (
                    <Chip key={agent.membershipId} size="small" label={agent.displayName} />
                  ))
                )}
                <Chip
                  size="small"
                  variant="outlined"
                  color={line.autoAssign ? 'primary' : 'default'}
                  label={line.autoAssign ? es.lines.autoAssignOn : es.lines.autoAssignOff}
                />
              </Stack>

              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {es.lines.color}
                </Typography>
                {has('channels.manage') ? (
                  <ColorPicker
                    label={`${es.lines.color} de ${line.name}`}
                    value={line.color}
                    emptyLabel={es.lines.noColor}
                    disabled={toggle.isPending}
                    onChange={(color) => toggle.mutate({ line, changes: { color } })}
                  />
                ) : (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={line.color?.toUpperCase() ?? es.lines.noColor}
                    sx={{ borderColor: line.color ?? undefined }}
                  />
                )}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {es.lines.colorHelp}
                </Typography>
              </Stack>

              {line.webhook && <WebhookInfo webhook={line.webhook} />}
            </CardContent>
            <Can anyOf={['channels.manage']}>
              <Divider />
              <CardActions sx={{ px: 2, flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => test.mutate(line)}
                  disabled={test.isPending}
                >
                  {es.lines.test}
                </Button>
                <Button size="small" onClick={() => setEditing(line)}>
                  {es.lines.edit}
                </Button>
                <Button
                  size="small"
                  onClick={() => setChoosingAgents(line)}
                  disabled={!members.data}
                >
                  {es.lines.manageAgents}
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    toggle.mutate({ line, changes: { enabled: line.status === 'DISABLED' } })
                  }
                >
                  {line.status === 'DISABLED' ? es.lines.enable : es.lines.disable}
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" color="error" onClick={() => setDeleting(line)}>
                  {es.lines.delete}
                </Button>
              </CardActions>
            </Can>
          </Card>
        ))
      )}

      {editing && (
        <LineDialog
          line={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
      {choosingAgents && members.data && (
        <LineAgentsDialog
          line={choosingAgents}
          members={members.data.items}
          onClose={() => setChoosingAgents(null)}
          onSubmit={async (membershipIds) => {
            await channelsApi.setAgents(workspaceId, choosingAgents.id, membershipIds)
            await refresh()
            enqueueSnackbar(es.lines.agentsSaved, { variant: 'success' })
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={es.lines.deleteTitle}
        confirmLabel={es.lines.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && es.lines.confirmDelete(deleting.name)}
      </ConfirmDialog>
    </Stack>
  )
}

/** The values to paste in Meta, with copy buttons and the setup steps. */
function WebhookInfo({ webhook }: { webhook: { url: string; verifyToken: string } }) {
  const isLocal = /\/\/(localhost|127\.0\.0\.1)/.test(webhook.url)
  return (
    <Box sx={{ mt: 2.5, p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {es.lines.webhookTitle}
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5, mb: 2, color: 'text.secondary' }}>
        {es.lines.webhookSteps.map((step) => (
          <Typography component="li" variant="body2" key={step}>
            {step}
          </Typography>
        ))}
      </Box>
      <Stack spacing={1.5}>
        <CopyField label={es.lines.webhookUrl} value={webhook.url} />
        <CopyField label={es.lines.verifyToken} value={webhook.verifyToken} />
      </Stack>
      {isLocal && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {es.lines.localhostWarning}
        </Alert>
      )}
    </Box>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { enqueueSnackbar } = useSnackbar()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      enqueueSnackbar(es.lines.copied, { variant: 'success' })
    } catch {
      // Clipboard blocked (insecure context): the field stays selectable.
    }
  }
  return (
    <TextField
      size="small"
      label={label}
      value={value}
      fullWidth
      slotProps={{
        htmlInput: { readOnly: true },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={es.lines.copy}>
                <IconButton
                  aria-label={`${es.lines.copy} ${label}`}
                  onClick={() => void copy()}
                  edge="end"
                  size="small"
                >
                  <ContentCopyOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

const DAY_MS = 24 * 60 * 60 * 1000
const msUntil = (iso: string) => new Date(iso).getTime() - Date.now()

/** Temporary tokens of Meta last about a day: warn before sending starts failing. */
function TokenExpiry({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null
  const left = msUntil(expiresAt)
  const date = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(expiresAt),
  )
  if (left <= 0) {
    return (
      <Typography variant="body2" color="error">
        {es.lines.tokenExpired(date)}
      </Typography>
    )
  }
  return (
    <Typography variant="body2" color={left < DAY_MS ? 'warning.main' : undefined}>
      {left < DAY_MS ? es.lines.tokenExpiresSoon(date) : es.lines.tokenExpires(date)}
    </Typography>
  )
}
