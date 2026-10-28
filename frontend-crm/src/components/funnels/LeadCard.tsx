import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import {
  Avatar,
  Box,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useDraggable } from '@dnd-kit/core'
import { memo, useState, type KeyboardEvent } from 'react'
import { es } from '../../i18n/es'
import type { BoardPreferences, FunnelStage, Lead } from '../../lib/api/funnels'
import type { TagSummary } from '../../lib/api/types'
import { avatarColor, initials, mediaLabel } from '../inbox/inbox-format'
import { canOpen, formatMoney, leadName } from './funnel-format'

const t = es.funnels.lead
const STATUS_COLORS = { OPEN: 'success', ON_HOLD: 'warning', CLOSED: 'default' } as const

/** What the card says about the chat: its last message, or why there is none. */
function snippet(lead: Lead): string {
  const chat = lead.conversation
  if (!chat) return t.noChat
  if (!chat.visible) return t.otherAgent
  const last = chat.lastMessage
  if (!last) return ''
  if (last.type === 'text' || last.text) return last.text ?? ''
  return mediaLabel(last.type)
}

export interface LeadCardProps {
  lead: Lead
  /** Stages it can move to (the ones you see). */
  stages: FunnelStage[]
  preferences: BoardPreferences
  tags: Map<string, TagSummary>
  canWrite: boolean
  /** Selecting leads: a click toggles the checkbox instead of opening the chat. */
  selecting: boolean
  selected: boolean
  onToggle: (lead: Lead) => void
  onOpen: (lead: Lead) => void
  onMove: (lead: Lead, stageId: string) => void
  onArchive: (lead: Lead, archived: boolean) => void
  onRemove: (lead: Lead) => void
  /** The copy that follows the pointer while dragging. */
  overlay?: boolean
}

function LeadCardBase({
  lead,
  stages,
  preferences,
  tags,
  canWrite,
  selecting,
  selected,
  onToggle,
  onOpen,
  onMove,
  onArchive,
  onRemove,
  overlay,
}: LeadCardProps) {
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lead:${lead.id}`,
    data: { type: 'lead', lead },
    disabled: !canWrite || selecting || overlay,
  })
  const name = leadName(lead)
  const chat = lead.conversation
  const agent = chat?.assignee
  const leadTags = (lead.contact?.tagIds ?? []).flatMap((id) => {
    const tag = tags.get(id)
    return tag ? [tag] : []
  })
  const activate = () => {
    if (selecting) onToggle(lead)
    else if (canOpen(lead)) onOpen(lead)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    // Enter opens; Space picks the card up to move it with the arrows.
    if (event.key === 'Enter') {
      event.preventDefault()
      activate()
      return
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      role="button"
      aria-label={name}
      onClick={activate}
      sx={{
        p: 1.25,
        borderRadius: 2,
        cursor: selecting ? 'pointer' : canWrite ? 'grab' : 'pointer',
        opacity: isDragging ? 0.4 : 1,
        borderColor: selected ? 'primary.main' : undefined,
        boxShadow: overlay ? 6 : undefined,
        touchAction: canWrite && !selecting ? 'none' : undefined,
        '&:hover': { borderColor: 'primary.light' },
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        {selecting ? (
          <Checkbox
            size="small"
            checked={selected}
            sx={{ p: 0.25 }}
            slotProps={{ input: { 'aria-label': t.select(name) } }}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggle(lead)}
          />
        ) : (
          <Avatar
            sx={{
              width: 30,
              height: 30,
              fontSize: 12,
              fontWeight: 600,
              bgcolor: avatarColor(lead.contact?.phone ?? lead.contactId),
            }}
          >
            {initials(name)}
          </Avatar>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontStyle: chat?.visible === false || !chat ? 'italic' : undefined,
              overflowWrap: 'anywhere',
            }}
          >
            {snippet(lead)}
          </Typography>
        </Box>
        {canWrite && !selecting && !overlay && (
          <IconButton
            size="small"
            aria-label={t.menu(name)}
            onClick={(event) => {
              event.stopPropagation()
              setMenu(event.currentTarget)
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            sx={{ mt: -0.5, mr: -0.5 }}
          >
            <MoreVertRounded fontSize="small" />
          </IconButton>
        )}
      </Stack>
      <Stack
        direction="row"
        useFlexGap
        sx={{ mt: 1, gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}
      >
        {chat && (
          <Chip
            size="small"
            variant="outlined"
            color={STATUS_COLORS[chat.status]}
            label={es.funnels.statuses[chat.status]}
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {lead.archivedAt && (
          <Chip
            size="small"
            label={lead.archivedBy ? t.archived : t.archivedAuto}
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {leadTags.slice(0, 3).map((tag) => (
          <Chip
            key={tag.id}
            size="small"
            variant="outlined"
            label={tag.name}
            sx={{ height: 20, fontSize: 11, borderColor: tag.color, color: tag.color }}
          />
        ))}
        {leadTags.length > 3 && (
          <Typography variant="caption" color="text.secondary">
            +{leadTags.length - 3}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {preferences.showValue && (
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {formatMoney(lead.amountCents)}
          </Typography>
        )}
        {preferences.showAgent && (
          <Tooltip title={agent?.name ?? t.unassigned}>
            <Avatar
              aria-label={agent?.name ?? t.unassigned}
              sx={{
                width: 22,
                height: 22,
                fontSize: 10,
                bgcolor: agent ? avatarColor(agent.membershipId) : 'action.disabled',
              }}
            >
              {agent ? initials(agent.name) : '–'}
            </Avatar>
          </Tooltip>
        )}
      </Stack>
      <Menu
        anchorEl={menu}
        open={!!menu}
        onClose={() => setMenu(null)}
        // A portal still bubbles through React: keep clicks off the card.
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {!lead.archivedAt && <ListSubheader>{t.moveTo}</ListSubheader>}
        {!lead.archivedAt &&
          stages
            .filter((stage) => stage.id !== lead.stageId)
            .map((stage) => (
              <MenuItem
                key={stage.id}
                onClick={() => {
                  setMenu(null)
                  onMove(lead, stage.id)
                }}
              >
                {stage.name}
              </MenuItem>
            ))}
        {!lead.archivedAt && <Divider />}
        <MenuItem
          onClick={() => {
            setMenu(null)
            onArchive(lead, !lead.archivedAt)
          }}
        >
          {lead.archivedAt ? t.restore : t.archive}
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setMenu(null)
            onRemove(lead)
          }}
        >
          {t.remove}
        </MenuItem>
      </Menu>
    </Paper>
  )
}

export const LeadCard = memo(LeadCardBase)
