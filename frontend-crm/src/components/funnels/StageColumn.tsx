import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { useWhenVisible } from '../../hooks/useWhenVisible'
import { es } from '../../i18n/es'
import type { BoardColumn, Lead } from '../../lib/api/funnels'
import { formatMoney } from './funnel-format'
import { LeadCard, type LeadCardProps } from './LeadCard'

const t = es.funnels.stage

export const COLUMN_WIDTH = 296

/**
 * A stage of the board: header with its count and total, then its leads.
 * The whole column takes the cards dropped on it; its handle reorders it.
 */
export function StageColumn({
  column,
  leads,
  hasMore,
  loadingMore,
  onLoadMore,
  canManage,
  canWrite,
  isSelected,
  card,
  onRename,
  onRemove,
  onSelectLeads,
  onSelectAll,
}: {
  column: BoardColumn
  /** The first page and the ones loaded with «Cargar más». */
  leads: Lead[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  canManage: boolean
  canWrite: boolean
  isSelected: (lead: Lead) => boolean
  card: Omit<LeadCardProps, 'lead' | 'selected'>
  onRename: () => void
  onRemove: () => void
  onSelectLeads: () => void
  onSelectAll: () => void
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const { stage } = column
  // 10 leads at a time: the next ones load when the end of the column shows.
  const end = useWhenVisible<HTMLDivElement>(onLoadMore, hasMore && !loadingMore, leads.length)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({
    id: `stage:${stage.id}`,
    data: { type: 'stage', stageId: stage.id },
    disabled: { draggable: !canManage, droppable: false },
  })
  // Highlight where a card would land (not while moving columns).
  const receiving = isOver && active?.data.current?.type === 'lead'
  const close = () => setMenu(null)

  return (
    <Paper
      ref={setNodeRef}
      component="section"
      aria-label={stage.name}
      variant="outlined"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{
        width: COLUMN_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
        borderRadius: 2,
        bgcolor: receiving ? 'action.selected' : 'background.default',
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'center', px: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        {canManage && (
          <IconButton
            ref={setActivatorNodeRef}
            size="small"
            aria-label={t.drag(stage.name)}
            {...attributes}
            {...listeners}
            sx={{ cursor: 'grab', touchAction: 'none' }}
          >
            <DragIndicatorRounded fontSize="small" />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0, pl: canManage ? 0 : 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
              {stage.name}
            </Typography>
            <Chip size="small" label={column.count} sx={{ height: 20, fontSize: 11 }} />
          </Stack>
          {card.preferences.showValue && (
            <Typography variant="caption" color="text.secondary">
              {formatMoney(column.totalCents)}
            </Typography>
          )}
        </Box>
        {(canManage || canWrite) && (
          <IconButton
            size="small"
            aria-label={t.menu(stage.name)}
            onClick={(event) => setMenu(event.currentTarget)}
          >
            <MoreHorizRounded fontSize="small" />
          </IconButton>
        )}
      </Stack>
      <Stack spacing={1} sx={{ p: 1, overflowY: 'auto', flex: 1, minHeight: 120 }}>
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} selected={isSelected(lead)} {...card} />
        ))}
        {leads.length === 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center', py: 3, fontStyle: 'italic' }}
          >
            {t.empty}
          </Typography>
        )}
        {hasMore && (
          <Box ref={end} sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            {loadingMore ? (
              <CircularProgress size={16} aria-label={t.loadMore} />
            ) : (
              <Button size="small" onClick={onLoadMore}>
                {t.loadMore}
              </Button>
            )}
          </Box>
        )}
      </Stack>
      <Menu anchorEl={menu} open={!!menu} onClose={close}>
        {canManage && (
          <MenuItem
            onClick={() => {
              close()
              onRename()
            }}
          >
            {t.rename}
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={() => {
              close()
              onRemove()
            }}
          >
            {t.remove}
          </MenuItem>
        )}
        {canWrite && (
          <MenuItem
            onClick={() => {
              close()
              onSelectLeads()
            }}
          >
            {t.selectLeads}
          </MenuItem>
        )}
        {canWrite && (
          <MenuItem
            disabled={column.count === 0}
            onClick={() => {
              close()
              onSelectAll()
            }}
          >
            {t.selectAll}
          </MenuItem>
        )}
      </Menu>
    </Paper>
  )
}
