import AddRounded from '@mui/icons-material/AddRounded'
import FilterListRounded from '@mui/icons-material/FilterListRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Link as RouterLink, useNavigate, useParams } from 'react-router'
import { usePermissions } from '../../../auth/usePermissions'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
import { AddLeadDialog } from '../../../components/funnels/AddLeadDialog'
import { AutomationDialog } from '../../../components/funnels/AutomationDialog'
import {
  activeFilters,
  canOpen,
  formatMoney,
  leadName,
} from '../../../components/funnels/funnel-format'
import { FunnelDialog } from '../../../components/funnels/FunnelDialog'
import { FunnelFilters } from '../../../components/funnels/FunnelFilters'
import { FunnelPermissionsDialog } from '../../../components/funnels/FunnelPermissionsDialog'
import { LeadCard, type LeadCardProps } from '../../../components/funnels/LeadCard'
import { LeadChatDialog, type LeadChat } from '../../../components/funnels/LeadChatDialog'
import { StageColumn } from '../../../components/funnels/StageColumn'
import { StageDeleteDialog, StageNameDialog } from '../../../components/funnels/StageDialogs'
import { SyncDialog } from '../../../components/funnels/SyncDialog'
import { useFunnelList, useInboxOptions } from '../../../components/funnels/useFunnels'
import { PageHeader } from '../../../components/PageHeader'
import { useFillHeight } from '../../../hooks/useFillHeight'
import { es } from '../../../i18n/es'
import { ApiError, errorMessage } from '../../../lib/api/errors'
import {
  funnelKeys,
  funnelsApi,
  NO_BOARD_FILTERS,
  type Board,
  type BoardFilters,
  type BoardPreferences,
  type BulkAction,
  type Funnel,
  type FunnelStage,
  type FunnelSummary,
  type Lead,
} from '../../../lib/api/funnels'

const t = es.funnels
const lastKey = (workspaceId: string) => `funnels:last:${workspaceId}`

function readLast(workspaceId: string): string | null {
  try {
    return localStorage.getItem(lastKey(workspaceId))
  } catch {
    return null
  }
}

function rememberLast(workspaceId: string, funnelId: string) {
  try {
    localStorage.setItem(lastKey(workspaceId), funnelId)
  } catch {
    // Private mode: the board just opens on the first funnel.
  }
}

/** /funnels and /funnels/:funnelId: the Kanban board of a funnel. */
export function FunnelBoardPage() {
  const workspaceId = useWorkspaceId()
  const { funnelId } = useParams()
  const { has } = usePermissions()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const list = useFunnelList()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (funnelId) rememberLast(workspaceId, funnelId)
  }, [workspaceId, funnelId])

  const create = async (input: Parameters<typeof funnelsApi.create>[1]) => {
    const funnel = await funnelsApi.create(workspaceId, input)
    await client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) })
    enqueueSnackbar(t.form.created, { variant: 'success' })
    void navigate(`/funnels/${funnel.id}`)
  }

  const header = <PageHeader title={t.title} subtitle={t.subtitle} />
  if (list.error) {
    const notInPlan =
      list.error instanceof ApiError && list.error.body?.code === 'FEATURE_NOT_IN_PLAN'
    return (
      <>
        {header}
        <Alert
          severity={notInPlan ? 'info' : 'error'}
          action={
            notInPlan && has('billing.read') ? (
              <Button component={RouterLink} to="/billing" color="inherit" size="small">
                {t.upgrade}
              </Button>
            ) : undefined
          }
        >
          {notInPlan ? t.notInPlan : errorMessage(list.error)}
        </Alert>
      </>
    )
  }
  if (!list.data) {
    return (
      <>
        {header}
        <Skeleton variant="rounded" height={420} />
      </>
    )
  }
  const funnels = list.data
  const dialog = creating && (
    <FunnelDialog funnel={null} onSubmit={create} onClose={() => setCreating(false)} />
  )
  if (funnels.length === 0) {
    return (
      <>
        {header}
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
          <ViewKanbanOutlined color="primary" sx={{ fontSize: 48 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mt: 1 }}>
            {t.empty}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mb: 2 }}>
            {has('funnels.manage') ? t.emptyHelp : t.emptyNoManage}
          </Typography>
          {has('funnels.manage') && (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => setCreating(true)}
            >
              {t.newFunnel}
            </Button>
          )}
        </Paper>
        {dialog}
      </>
    )
  }
  const current = funnels.find((funnel) => funnel.id === funnelId)
  if (!current) {
    const last = readLast(workspaceId)
    const target = funnels.find((funnel) => funnel.id === last) ?? funnels[0]
    return <Navigate to={`/funnels/${target?.id ?? ''}`} replace />
  }
  return (
    <>
      <FunnelBoard
        key={current.id}
        workspaceId={workspaceId}
        summary={current}
        funnels={funnels}
        onCreate={() => setCreating(true)}
      />
      {dialog}
    </>
  )
}

/** Dialogs the board opens, one at a time. */
type Open =
  | { kind: 'edit' }
  | { kind: 'deleteFunnel' }
  | { kind: 'addStage' }
  | { kind: 'renameStage'; stage: FunnelStage }
  | { kind: 'deleteStage'; stage: FunnelStage; leads: number }
  | { kind: 'addLead'; stageId?: string }
  | { kind: 'sync' }
  | { kind: 'permissions' }
  | { kind: 'automation' }
  | { kind: 'removeLead'; lead: Lead }
  | { kind: 'bulk'; action: BulkAction; moveTo?: string }
  | null

/** Leads chosen for a bulk action: some of them, or a whole stage. */
type Selection = { kind: 'leads'; ids: string[] } | { kind: 'stage'; stageId: string } | null

function FunnelBoard({
  workspaceId,
  summary,
  funnels,
  onCreate,
}: {
  workspaceId: string
  summary: FunnelSummary
  funnels: FunnelSummary[]
  onCreate: () => void
}) {
  const { has } = usePermissions()
  const canWrite = has('funnels.write')
  const canManage = has('funnels.manage')
  const navigate = useNavigate()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const tags = useTags()
  const options = useInboxOptions()
  const { ref: fillRef, height } = useFillHeight<HTMLDivElement>()
  const [filters, setFilters] = useState<BoardFilters>(NO_BOARD_FILTERS)
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [more, setMore] = useState<HTMLElement | null>(null)
  const [customize, setCustomize] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const [chat, setChat] = useState<LeadChat | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [dragging, setDragging] = useState<Lead | null>(null)
  /** Leads loaded with «Cargar más», by stage, and whether there are more. */
  const [extra, setExtra] = useState<Record<string, Lead[]>>({})
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({})
  const [loadingMore, setLoadingMore] = useState<string | null>(null)

  /** Other filters: other pages, and nothing selected. */
  const changeFilters = (update: (current: BoardFilters) => BoardFilters) => {
    setFilters(update)
    setExtra({})
    setHasMore({})
    setSelection(null)
  }
  // The search waits for a pause in the typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim()
      if (next !== filters.search) changeFilters((current) => ({ ...current, search: next }))
    }, 300)
    return () => clearTimeout(timer)
  }, [search, filters.search])

  const key = funnelKeys.board(workspaceId, summary.id, filters)
  const board = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => funnelsApi.board(workspaceId, summary.id, filters, signal),
    placeholderData: keepPreviousData,
  })
  const funnel: Funnel | undefined = board.data?.funnel
  const preferences = board.data?.preferences ?? { showValue: true, showAgent: true }
  const stages = useMemo(() => funnel?.stages ?? [], [funnel])
  const tagMap = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data])

  const refresh = () => client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) })
  const fail = (error: unknown) => {
    enqueueSnackbar(errorMessage(error), { variant: 'error' })
    if (error instanceof ApiError && error.body?.code === 'LEAD_CHANGED') void refresh()
  }

  /** The board as it looks after moving a lead (counts and totals included). */
  const moved = (current: Board, lead: Lead, stageId: string): Board => ({
    ...current,
    columns: current.columns.map((column) => {
      if (column.stage.id === lead.stageId)
        return {
          ...column,
          count: column.count - 1,
          totalCents: column.totalCents - lead.amountCents,
          leads: column.leads.filter((item) => item.id !== lead.id),
        }
      if (column.stage.id === stageId)
        return {
          ...column,
          count: column.count + 1,
          totalCents: column.totalCents + lead.amountCents,
          leads: [{ ...lead, stageId }, ...column.leads],
        }
      return column
    }),
  })

  const move = useMutation({
    mutationFn: ({ lead, stageId }: { lead: Lead; stageId: string }) =>
      funnelsApi.moveLead(workspaceId, summary.id, lead.id, stageId, lead.version),
    onMutate: async ({ lead, stageId }) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Board>(key)
      if (previous) client.setQueryData(key, moved(previous, lead, stageId))
      setExtra((current) => ({
        ...current,
        [lead.stageId]: (current[lead.stageId] ?? []).filter((item) => item.id !== lead.id),
      }))
      return { previous }
    },
    onError: (error, _, context) => {
      // Back where it was.
      if (context?.previous) client.setQueryData(key, context.previous)
      setExtra({})
      fail(error)
    },
    onSettled: refresh,
  })

  const leadAction = useMutation({
    mutationFn: async (input: { lead: Lead; archived?: boolean; remove?: boolean }) => {
      if (input.remove) await funnelsApi.removeLead(workspaceId, summary.id, input.lead.id)
      else await funnelsApi.archiveLead(workspaceId, summary.id, input.lead.id, !!input.archived)
    },
    onSuccess: () => setOpen(null),
    onError: fail,
    onSettled: refresh,
  })

  const bulk = useMutation({
    mutationFn: ({ action, moveTo }: { action: BulkAction; moveTo?: string }) =>
      funnelsApi.bulk(workspaceId, summary.id, {
        action,
        moveTo,
        archived: filters.archived,
        ...(selection?.kind === 'stage'
          ? { stageId: selection.stageId }
          : { leadIds: selection?.ids ?? [] }),
      }),
    onSuccess: (result) => {
      enqueueSnackbar(t.bulk.done(result.affected), { variant: 'success' })
      setSelection(null)
      setOpen(null)
    },
    onError: fail,
    onSettled: refresh,
  })

  const setPreferences = useMutation({
    mutationFn: (next: BoardPreferences) =>
      funnelsApi.setPreferences(workspaceId, summary.id, next),
    onMutate: (next) => {
      const previous = client.getQueryData<Board>(key)
      if (previous) client.setQueryData(key, { ...previous, preferences: next })
      return { previous }
    },
    onError: (error, _, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
      fail(error)
    },
  })

  const reorder = useMutation({
    mutationFn: (stageIds: string[]) => funnelsApi.reorderStages(workspaceId, summary.id, stageIds),
    onMutate: (stageIds) => {
      const previous = client.getQueryData<Board>(key)
      if (previous) {
        const byId = new Map(previous.columns.map((column) => [column.stage.id, column]))
        client.setQueryData(key, {
          ...previous,
          columns: stageIds.flatMap((id) => byId.get(id) ?? []),
        })
      }
      return { previous }
    },
    onError: (error, _, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
      fail(error)
    },
    onSettled: refresh,
  })

  const loadMore = async (stageId: string, offset: number) => {
    setLoadingMore(stageId)
    try {
      const page = await funnelsApi.stageLeads(workspaceId, summary.id, stageId, filters, offset)
      setExtra((current) => ({
        ...current,
        [stageId]: [...(current[stageId] ?? []), ...page.leads],
      }))
      setHasMore((current) => ({ ...current, [stageId]: page.hasMore }))
    } catch (error: unknown) {
      fail(error)
    } finally {
      setLoadingMore(null)
    }
  }

  const exportCsv = async () => {
    try {
      const blob = await funnelsApi.exportCsv(workspaceId, summary.id, filters)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${summary.name.replace(/[\\/:*?"<>|]+/g, '_')}.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      enqueueSnackbar(t.exported, { variant: 'success' })
    } catch (error: unknown) {
      fail(error)
    }
  }

  // ───────────── Drag and drop ─────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  const collision: CollisionDetection = (args) => {
    if (args.active.data.current?.type === 'stage') return closestCenter(args)
    const within = pointerWithin(args)
    return within.length > 0 ? within : rectIntersection(args)
  }
  const stageName = (id: unknown) => stages.find((stage) => `stage:${stage.id}` === id)?.name ?? ''
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      active.data.current?.type === 'lead'
        ? `${leadName(active.data.current.lead as Lead)} tomado. Usa las flechas para cambiar de etapa y Espacio para soltar.`
        : `Etapa ${stageName(active.id)} tomada.`,
    onDragOver: ({ over }) => (over ? `Sobre la etapa ${stageName(over.id)}.` : undefined),
    onDragEnd: ({ over }) => (over ? `Soltado en ${stageName(over.id)}.` : 'Soltado fuera.'),
    onDragCancel: () => 'Movimiento cancelado.',
  }
  const onDragStart = ({ active }: DragStartEvent) => {
    if (active.data.current?.type === 'lead') setDragging(active.data.current.lead as Lead)
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const target = over?.data.current?.stageId as string | undefined
    if (!target) return
    if (active.data.current?.type === 'lead') {
      const lead = active.data.current.lead as Lead
      if (target !== lead.stageId) move.mutate({ lead, stageId: target })
      return
    }
    const from = active.data.current?.stageId as string
    const ids = stages.map((stage) => stage.id)
    const fromIndex = ids.indexOf(from)
    const toIndex = ids.indexOf(target)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    reorder.mutate(arrayMove(ids, fromIndex, toIndex))
  }

  // ───────────── Selection ─────────────
  const columnLeads = (stageId: string): Lead[] => {
    const column = board.data?.columns.find((item) => item.stage.id === stageId)
    const first = column?.leads ?? []
    const seen = new Set(first.map((lead) => lead.id))
    return [...first, ...(extra[stageId] ?? []).filter((lead) => !seen.has(lead.id))]
  }
  const isSelected = (lead: Lead) =>
    selection?.kind === 'stage'
      ? selection.stageId === lead.stageId
      : !!selection?.ids.includes(lead.id)
  const toggle = (lead: Lead) =>
    setSelection((current) => {
      if (current?.kind === 'stage') {
        // From "the whole stage" to "these leads", minus this one.
        const ids = columnLeads(current.stageId)
          .map((item) => item.id)
          .filter((id) => id !== lead.id)
        return { kind: 'leads', ids }
      }
      const ids = current?.ids ?? []
      return {
        kind: 'leads',
        ids: ids.includes(lead.id) ? ids.filter((id) => id !== lead.id) : [...ids, lead.id],
      }
    })
  const selectedCount =
    selection?.kind === 'stage'
      ? (board.data?.columns.find((column) => column.stage.id === selection.stageId)?.count ?? 0)
      : (selection?.ids.length ?? 0)

  const card: Omit<LeadCardProps, 'lead' | 'selected'> = {
    stages,
    preferences,
    tags: tagMap,
    canWrite,
    selecting: selection !== null,
    onToggle: toggle,
    onOpen: (lead) =>
      setChat({
        contactId: lead.contactId,
        name: leadName(lead),
        conversationId: lead.conversation?.id ?? null,
        visible: canOpen(lead),
      }),
    onMove: (lead, stageId) => move.mutate({ lead, stageId }),
    onArchive: (lead, archived) => leadAction.mutate({ lead, archived }),
    onRemove: (lead) => setOpen({ kind: 'removeLead', lead }),
  }

  const byLine = useMemo(() => {
    const groups = new Map<string, FunnelSummary[]>()
    for (const item of funnels)
      groups.set(item.lineName, [...(groups.get(item.lineName) ?? []), item])
    return [...groups.entries()]
  }, [funnels])
  const filterCount = activeFilters(filters)

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ mb: 2, alignItems: { md: 'center' } }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <TextField
            select
            size="small"
            label={t.funnel}
            value={summary.id}
            onChange={(event) => void navigate(`/funnels/${event.target.value}`)}
            sx={{ minWidth: 220 }}
          >
            {byLine.flatMap(([line, items]) => [
              <ListSubheader key={`line:${line}`}>{line}</ListSubheader>,
              ...items.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                  {item.isPrimary ? ` · ${t.primary}` : ''}
                </MenuItem>
              )),
            ])}
          </TextField>
          {canManage && (
            <Tooltip title={t.newFunnel}>
              <IconButton aria-label={t.newFunnel} onClick={onCreate}>
                <AddRounded />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <TextField
          size="small"
          placeholder={t.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: 1, maxWidth: { md: 360 } }}
          slotProps={{
            htmlInput: { 'aria-label': t.search },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          useFlexGap
        >
          <Button
            variant="outlined"
            startIcon={
              <Badge color="primary" badgeContent={filterCount}>
                <FilterListRounded />
              </Badge>
            }
            onClick={() => setFiltersOpen(true)}
          >
            {t.filters}
          </Button>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              disabled={stages.length === 0}
              onClick={() => setOpen({ kind: 'addLead' })}
            >
              {t.addLead}
            </Button>
          )}
          <Tooltip title={t.customize}>
            <IconButton
              aria-label={t.customize}
              onClick={(event) => setCustomize(event.currentTarget)}
            >
              <TuneRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.more}>
            <IconButton aria-label={t.more} onClick={(event) => setMore(event.currentTarget)}>
              <MoreVertRounded />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {board.data && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
          useFlexGap
        >
          <Chip size="small" label={t.total(board.data.count)} />
          {preferences.showValue && (
            <Chip size="small" variant="outlined" label={formatMoney(board.data.totalCents)} />
          )}
          {summary.isPrimary && <Chip size="small" color="primary" label={t.primary} />}
          {summary.description && (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {summary.description}
            </Typography>
          )}
        </Stack>
      )}
      {filters.archived && (
        <Alert
          severity="info"
          sx={{ mb: 1.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => changeFilters((current) => ({ ...current, archived: false }))}
            >
              {t.showActive}
            </Button>
          }
        >
          {t.archivedView}
        </Alert>
      )}
      {board.error && !board.data && <Alert severity="error">{errorMessage(board.error)}</Alert>}

      <Box
        ref={fillRef}
        sx={{
          height: height ?? 560,
          overflowX: 'auto',
          overflowY: 'hidden',
          pb: selection ? 9 : 1,
        }}
      >
        {!board.data ? (
          <Stack direction="row" spacing={1.5} sx={{ height: 1 }}>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} variant="rounded" width={296} height="100%" />
            ))}
          </Stack>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable:
                  'Para mover, pulsa Espacio, usa las flechas y vuelve a pulsar Espacio. Escape cancela. Enter abre el chat.',
              },
            }}
          >
            <SortableContext
              items={board.data.columns.map((column) => `stage:${column.stage.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              <Stack direction="row" spacing={1.5} sx={{ height: 1, alignItems: 'stretch' }}>
                {board.data.columns.map((column) => {
                  const leads = columnLeads(column.stage.id)
                  return (
                    <StageColumn
                      key={column.stage.id}
                      column={column}
                      leads={leads}
                      hasMore={hasMore[column.stage.id] ?? column.hasMore}
                      loadingMore={loadingMore === column.stage.id}
                      onLoadMore={() => void loadMore(column.stage.id, leads.length)}
                      canManage={canManage}
                      canWrite={canWrite}
                      isSelected={isSelected}
                      card={card}
                      onRename={() => setOpen({ kind: 'renameStage', stage: column.stage })}
                      onRemove={() =>
                        setOpen({ kind: 'deleteStage', stage: column.stage, leads: column.count })
                      }
                      onSelectLeads={() => setSelection({ kind: 'leads', ids: [] })}
                      onSelectAll={() => setSelection({ kind: 'stage', stageId: column.stage.id })}
                    />
                  )
                })}
                {canManage && !filters.archived && (
                  <Button
                    variant="outlined"
                    startIcon={<AddRounded />}
                    onClick={() => setOpen({ kind: 'addStage' })}
                    sx={{ flexShrink: 0, alignSelf: 'flex-start', borderStyle: 'dashed' }}
                  >
                    {t.stage.add}
                  </Button>
                )}
              </Stack>
            </SortableContext>
            <DragOverlay>
              {dragging && <LeadCard lead={dragging} selected={false} overlay {...card} />}
            </DragOverlay>
          </DndContext>
        )}
      </Box>

      {selection && (
        <BulkBar
          count={selectedCount}
          label={
            selection.kind === 'stage'
              ? t.bulk.wholeStage(
                  stages.find((stage) => stage.id === selection.stageId)?.name ?? '',
                  selectedCount,
                )
              : t.bulk.selected(selectedCount)
          }
          stages={stages}
          archived={filters.archived}
          onAction={(action, moveTo) => setOpen({ kind: 'bulk', action, moveTo })}
          onCancel={() => setSelection(null)}
        />
      )}

      <Popover
        open={!!customize}
        anchorEl={customize}
        onClose={() => setCustomize(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Stack sx={{ p: 2 }} role="group" aria-label={t.customize}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t.customize}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={preferences.showValue}
                onChange={(_, checked) =>
                  setPreferences.mutate({ ...preferences, showValue: checked })
                }
              />
            }
            label={t.showValue}
          />
          <FormControlLabel
            control={
              <Switch
                checked={preferences.showAgent}
                onChange={(_, checked) =>
                  setPreferences.mutate({ ...preferences, showAgent: checked })
                }
              />
            }
            label={t.showAgent}
          />
        </Stack>
      </Popover>

      <Menu anchorEl={more} open={!!more} onClose={() => setMore(null)}>
        {canManage && (
          <MenuItem
            onClick={() => {
              setMore(null)
              setOpen({ kind: 'edit' })
            }}
          >
            {t.editFunnel}
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            onClick={() => {
              setMore(null)
              setOpen({ kind: 'sync' })
            }}
          >
            {t.sync}
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            onClick={() => {
              setMore(null)
              setOpen({ kind: 'permissions' })
            }}
          >
            {t.permissions}
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            onClick={() => {
              setMore(null)
              setOpen({ kind: 'automation' })
            }}
          >
            {t.automation}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMore(null)
            void exportCsv()
          }}
        >
          {t.export}
        </MenuItem>
      </Menu>

      <FunnelFilters
        open={filtersOpen}
        applied={filters}
        members={options.data?.members ?? []}
        tags={tags.data ?? []}
        onApply={(next) => {
          changeFilters(() => next)
          setSearch(next.search)
        }}
        onClose={() => setFiltersOpen(false)}
      />

      {chat && funnel && (
        <LeadChatDialog
          workspaceId={workspaceId}
          funnel={funnel}
          chat={chat}
          onClose={() => setChat(null)}
        />
      )}

      {open?.kind === 'edit' && funnel && (
        <FunnelDialog
          funnel={funnel}
          onSubmit={async (input) => {
            await funnelsApi.update(workspaceId, summary.id, {
              lineId: input.lineId,
              name: input.name,
              description: input.description,
              isPrimary: input.isPrimary,
              archiveAfterDays: input.archiveAfterDays,
            })
            await refresh()
            enqueueSnackbar(t.form.saved, { variant: 'success' })
          }}
          onDelete={() => setOpen({ kind: 'deleteFunnel' })}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'deleteFunnel' && (
        <DeleteFunnel
          workspaceId={workspaceId}
          summary={summary}
          onDone={() => {
            setOpen(null)
            enqueueSnackbar(t.form.removed, { variant: 'success' })
            void navigate('/funnels', { replace: true })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {(open?.kind === 'addStage' || open?.kind === 'renameStage') && (
        <StageNameDialog
          stage={open.kind === 'renameStage' ? open.stage : null}
          onSubmit={async (name) => {
            if (open.kind === 'renameStage')
              await funnelsApi.renameStage(workspaceId, summary.id, open.stage.id, name)
            else await funnelsApi.addStage(workspaceId, summary.id, name)
            await refresh()
            enqueueSnackbar(t.stage.saved, { variant: 'success' })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'deleteStage' && (
        <StageDeleteDialog
          stage={open.stage}
          leads={open.leads}
          stages={stages}
          onSubmit={async (moveTo) => {
            await funnelsApi.removeStage(workspaceId, summary.id, open.stage.id, moveTo)
            await refresh()
            enqueueSnackbar(t.stage.removed, { variant: 'success' })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'addLead' && (
        <AddLeadDialog
          workspaceId={workspaceId}
          stages={stages}
          defaultStageId={open.stageId}
          onSubmit={async (contactId, stageId) => {
            await funnelsApi.addLead(workspaceId, summary.id, contactId, stageId)
            await refresh()
            enqueueSnackbar(t.addLeadForm.added, { variant: 'success' })
          }}
          onOpenExisting={(contact) => {
            setOpen(null)
            setChat({ contactId: contact.id, name: contact.name ?? contact.phone })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'sync' && funnel && (
        <SyncDialog
          funnel={funnel}
          onSubmit={async (rules) => {
            const result = await funnelsApi.sync(workspaceId, summary.id, rules)
            await refresh()
            return result
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'permissions' && (
        <FunnelPermissionsDialog
          workspaceId={workspaceId}
          funnelId={summary.id}
          onSubmit={async (members) => {
            await funnelsApi.setPermissions(workspaceId, summary.id, members)
            await refresh()
            enqueueSnackbar(t.permissionsForm.saved, { variant: 'success' })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'automation' && (
        <AutomationDialog
          workspaceId={workspaceId}
          defaultLineId={summary.lineId}
          onSubmit={async (lineId, rules) => {
            await funnelsApi.setAutomation(workspaceId, lineId, rules)
            await refresh()
            enqueueSnackbar(t.automationForm.saved, { variant: 'success' })
          }}
          onClose={() => setOpen(null)}
        />
      )}
      <ConfirmDialog
        open={open?.kind === 'removeLead'}
        title={t.lead.remove}
        confirmLabel={t.lead.remove}
        danger
        loading={leadAction.isPending}
        onConfirm={() =>
          open?.kind === 'removeLead' && leadAction.mutate({ lead: open.lead, remove: true })
        }
        onClose={() => setOpen(null)}
      >
        {open?.kind === 'removeLead' ? t.lead.removeBody(leadName(open.lead)) : ''}
      </ConfirmDialog>
      <ConfirmDialog
        open={open?.kind === 'bulk'}
        title={t.bulk.confirmTitle}
        confirmLabel={
          open?.kind === 'bulk'
            ? {
                move: t.bulk.moveTo,
                archive: t.bulk.archive,
                restore: t.bulk.restore,
                remove: t.bulk.remove,
              }[open.action]
            : ''
        }
        danger={open?.kind === 'bulk' && open.action === 'remove'}
        loading={bulk.isPending}
        onConfirm={() =>
          open?.kind === 'bulk' && bulk.mutate({ action: open.action, moveTo: open.moveTo })
        }
        onClose={() => setOpen(null)}
      >
        {open?.kind === 'bulk' &&
          {
            move: t.bulk.confirmMove(
              selectedCount,
              stages.find((stage) => stage.id === open.moveTo)?.name ?? '',
            ),
            archive: t.bulk.confirmArchive(selectedCount),
            restore: t.bulk.confirmRestore(selectedCount),
            remove: t.bulk.confirmRemove(selectedCount),
          }[open.action]}
      </ConfirmDialog>
    </Box>
  )
}

/** The bar of «Seleccionar leads»: what to do with the chosen ones. */
function BulkBar({
  count,
  label,
  stages,
  archived,
  onAction,
  onCancel,
}: {
  count: number
  label: string
  stages: FunnelStage[]
  archived: boolean
  onAction: (action: BulkAction, moveTo?: string) => void
  onCancel: () => void
}) {
  const [moveMenu, setMoveMenu] = useState<HTMLElement | null>(null)
  return (
    <Paper
      elevation={8}
      role="toolbar"
      aria-label={label}
      sx={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        px: 2,
        py: 1,
        borderRadius: 3,
        zIndex: (theme) => theme.zIndex.appBar,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
          {label}
        </Typography>
        {!archived && (
          <Button
            size="small"
            disabled={count === 0}
            onClick={(event) => setMoveMenu(event.currentTarget)}
          >
            {t.bulk.moveTo}
          </Button>
        )}
        <Button
          size="small"
          disabled={count === 0}
          onClick={() => onAction(archived ? 'restore' : 'archive')}
        >
          {archived ? t.bulk.restore : t.bulk.archive}
        </Button>
        <Button
          size="small"
          color="error"
          disabled={count === 0}
          onClick={() => onAction('remove')}
        >
          {t.bulk.remove}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t.bulk.cancel}
        </Button>
      </Stack>
      <Menu anchorEl={moveMenu} open={!!moveMenu} onClose={() => setMoveMenu(null)}>
        {stages.map((stage) => (
          <MenuItem
            key={stage.id}
            onClick={() => {
              setMoveMenu(null)
              onAction('move', stage.id)
            }}
          >
            {stage.name}
          </MenuItem>
        ))}
      </Menu>
    </Paper>
  )
}

/** Deleting a funnel: its leads go with it (contacts and chats stay). */
function DeleteFunnel({
  workspaceId,
  summary,
  onDone,
  onClose,
}: {
  workspaceId: string
  summary: FunnelSummary
  onDone: () => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const remove = useMutation({
    mutationFn: () => funnelsApi.remove(workspaceId, summary.id, summary.leads > 0),
    onSuccess: async () => {
      client.removeQueries({ queryKey: funnelKeys.boards(workspaceId, summary.id) })
      await client.invalidateQueries({ queryKey: funnelKeys.all(workspaceId) })
      onDone()
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  return (
    <ConfirmDialog
      open
      title={t.form.removeTitle(summary.name)}
      confirmLabel={t.deleteFunnel}
      danger
      loading={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {t.form.removeBody(summary.leads)}
    </ConfirmDialog>
  )
}
