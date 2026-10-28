import CloseRounded from '@mui/icons-material/CloseRounded'
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Drawer,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import {
  CHAT_STATUSES,
  NO_BOARD_FILTERS,
  type BoardFilters,
  type BoardSort,
} from '../../lib/api/funnels'
import type { Assignee } from '../../lib/api/inbox'
import type { TagSummary } from '../../lib/api/types'
import { moneyInput, parseMoney } from './funnel-format'

const t = es.funnels.filtersForm
const SORTS: BoardSort[] = ['recent', 'value_desc', 'value_asc']

/**
 * The board's filters: a draft applied with «Aplicar» (AND between the
 * groups, OR inside each one). «Limpiar» keeps the search.
 */
export function FunnelFilters({
  open,
  applied,
  members,
  tags,
  onApply,
  onClose,
}: {
  open: boolean
  applied: BoardFilters
  members: Assignee[]
  tags: TagSummary[]
  onApply: (filters: BoardFilters) => void
  onClose: () => void
}) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      {open && (
        <FiltersForm
          applied={applied}
          members={members}
          tags={tags}
          onApply={onApply}
          onClose={onClose}
        />
      )}
    </Drawer>
  )
}

function FiltersForm({
  applied,
  members,
  tags,
  onApply,
  onClose,
}: {
  applied: BoardFilters
  members: Assignee[]
  tags: TagSummary[]
  onApply: (filters: BoardFilters) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(applied)
  const [min, setMin] = useState(applied.minCents === null ? '' : moneyInput(applied.minCents))
  const [max, setMax] = useState(applied.maxCents === null ? '' : moneyInput(applied.maxCents))
  const set = (changes: Partial<BoardFilters>) =>
    setDraft((current) => ({ ...current, ...changes }))
  const minCents = parseMoney(min)
  const maxCents = parseMoney(max)
  const invalidMin = Number.isNaN(minCents)
  const invalidMax = Number.isNaN(maxCents)
  const badRange = minCents !== null && maxCents !== null && minCents > maxCents
  const valid = !invalidMin && !invalidMax && !badRange

  return (
    <Box
      role="region"
      aria-label={t.title}
      sx={{ width: { xs: '100vw', sm: 380 }, display: 'flex', flexDirection: 'column', height: 1 }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <IconButton aria-label={es.funnels.chat.close} onClick={onClose}>
          <CloseRounded />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t.title}
        </Typography>
      </Stack>
      <Stack spacing={2.5} sx={{ p: 2, flex: 1, overflowY: 'auto' }}>
        <Autocomplete
          multiple
          size="small"
          options={members}
          value={members.filter((member) => draft.agentIds.includes(member.membershipId))}
          getOptionLabel={(member) => member.name}
          isOptionEqualToValue={(option, value) => option.membershipId === value.membershipId}
          onChange={(_, chosen) => set({ agentIds: chosen.map((member) => member.membershipId) })}
          renderInput={(props) => <TextField {...props} label={t.agents} />}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={draft.unassigned}
              onChange={(_, checked) => set({ unassigned: checked })}
            />
          }
          label={t.unassigned}
        />
        <Autocomplete
          multiple
          size="small"
          options={tags}
          value={tags.filter((tag) => draft.tagIds.includes(tag.id))}
          getOptionLabel={(tag) => tag.name}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          onChange={(_, chosen) => set({ tagIds: chosen.map((tag) => tag.id) })}
          renderValue={(chosen, getItemProps) =>
            chosen.map((tag, index) => {
              const { key, ...itemProps } = getItemProps({ index })
              return (
                <Chip
                  key={key}
                  size="small"
                  variant="outlined"
                  label={tag.name}
                  sx={{ borderColor: tag.color, color: tag.color }}
                  {...itemProps}
                />
              )
            })
          }
          renderInput={(props) => <TextField {...props} label={t.tags} />}
        />
        <Box>
          <FormLabel component="legend" sx={{ fontSize: 14 }}>
            {t.statuses}
          </FormLabel>
          <FormGroup row>
            {CHAT_STATUSES.map((status) => (
              <FormControlLabel
                key={status}
                control={
                  <Checkbox
                    checked={draft.statuses.includes(status)}
                    onChange={(_, checked) =>
                      set({
                        statuses: checked
                          ? [...draft.statuses, status]
                          : draft.statuses.filter((item) => item !== status),
                      })
                    }
                  />
                }
                label={es.funnels.statuses[status]}
              />
            ))}
          </FormGroup>
        </Box>
        <FormControlLabel
          control={
            <Switch
              checked={draft.archived}
              onChange={(_, checked) => set({ archived: checked })}
            />
          }
          label={t.archived}
        />
        <Stack direction="row" spacing={1.5}>
          <TextField
            size="small"
            label={t.min}
            value={min}
            onChange={(event) => setMin(event.target.value)}
            error={invalidMin || badRange}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            size="small"
            label={t.max}
            value={max}
            onChange={(event) => setMax(event.target.value)}
            error={invalidMax || badRange}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
        </Stack>
        {badRange && (
          <Typography variant="caption" color="error" role="alert">
            {t.rangeError}
          </Typography>
        )}
        <TextField
          select
          size="small"
          label={t.sort}
          value={draft.sort}
          onChange={(event) => set({ sort: event.target.value as BoardSort })}
        >
          {SORTS.map((sort) => (
            <MenuItem key={sort} value={sort}>
              {t.sorts[sort]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ p: 2, borderTop: 1, borderColor: 'divider', justifyContent: 'flex-end' }}
      >
        <Button
          onClick={() => {
            onApply({ ...NO_BOARD_FILTERS, search: applied.search })
            onClose()
          }}
        >
          {t.clear}
        </Button>
        <Button
          variant="contained"
          disabled={!valid}
          onClick={() => {
            onApply({
              ...draft,
              minCents: minCents === null || Number.isNaN(minCents) ? null : minCents,
              maxCents: maxCents === null || Number.isNaN(maxCents) ? null : maxCents,
            })
            onClose()
          }}
        >
          {t.apply}
        </Button>
      </Stack>
    </Box>
  )
}
