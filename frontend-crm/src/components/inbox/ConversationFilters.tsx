import CloseRounded from '@mui/icons-material/CloseRounded'
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined'
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { Assignee } from '../../lib/api/inbox'
import type { TagSummary } from '../../lib/api/types'
import { NO_FILTERS, type ListFilters } from './list-filters'

const UNASSIGNED: Assignee = { membershipId: 'none', userId: '', name: 'Sin asignar' }

export function ConversationFilters({
  applied,
  onApply,
  onClose,
  tags,
  members,
  canFilterAgents,
  lines,
}: {
  applied: ListFilters
  onApply: (filters: ListFilters) => void
  onClose: () => void
  tags: TagSummary[]
  members: Assignee[]
  canFilterAgents: boolean
  lines: { id: string; name: string }[]
}) {
  const [draft, setDraft] = useState(applied)
  const set = (changes: Partial<ListFilters>) => setDraft((current) => ({ ...current, ...changes }))
  const agents = [UNASSIGNED, ...members]
  return (
    <Box
      role="region"
      aria-label="Filtros de conversaciones"
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <IconButton aria-label="Cerrar filtros" onClick={onClose}>
          <CloseRounded />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Filtros de conversaciones
        </Typography>
      </Stack>
      <Stack spacing={2.5} sx={{ p: 2, flex: 1, overflowY: 'auto' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Filtrar por etiquetas
          </Typography>
          <Autocomplete
            multiple
            size="small"
            options={tags}
            value={tags.filter((tag) => draft.tagIds.includes(tag.id))}
            onChange={(_, value) => set({ tagIds: value.map((tag) => tag.id) })}
            getOptionLabel={(tag) => tag.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            noOptionsText="No hay etiquetas"
            renderValue={(value, getItemProps) =>
              value.map((tag, index) => {
                const { key, ...props } = getItemProps({ index })
                return (
                  <Chip
                    key={key}
                    {...props}
                    size="small"
                    label={tag.name}
                    sx={{ bgcolor: tag.color, color: '#fff' }}
                  />
                )
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={draft.tagIds.length ? '' : 'Seleccionar etiquetas'}
                slotProps={{
                  ...params.slotProps,
                  htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Etiquetas' },
                }}
              />
            )}
          />
        </Box>
        {canFilterAgents && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Filtrar por agentes
            </Typography>
            <Autocomplete
              multiple
              size="small"
              options={agents}
              value={agents.filter((agent) => draft.assigneeIds.includes(agent.membershipId))}
              onChange={(_, value) =>
                set({ assigneeIds: value.map((agent) => agent.membershipId) })
              }
              getOptionLabel={(agent) => agent.name}
              isOptionEqualToValue={(option, value) => option.membershipId === value.membershipId}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={draft.assigneeIds.length ? '' : 'Seleccionar agentes'}
                  slotProps={{
                    ...params.slotProps,
                    htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Agentes' },
                  }}
                />
              )}
            />
          </Box>
        )}
        {lines.length > 1 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Filtrar por línea
            </Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={draft.lineId}
              onChange={(event) => set({ lineId: event.target.value })}
              slotProps={{ htmlInput: { 'aria-label': 'Línea' } }}
            >
              <MenuItem value="">Todas las líneas</MenuItem>
              {lines.map((line) => (
                <MenuItem key={line.id} value={line.id}>
                  {line.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        )}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Filtrar por rango de fechas
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              type="date"
              size="small"
              label="Desde"
              fullWidth
              value={draft.from}
              onChange={(event) => set({ from: event.target.value })}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: draft.to || undefined },
              }}
            />
            <TextField
              type="date"
              size="small"
              label="Hasta"
              fullWidth
              value={draft.to}
              onChange={(event) => set({ to: event.target.value })}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { min: draft.from || undefined },
              }}
            />
          </Stack>
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Ordenar conversaciones
          </Typography>
          <TextField
            select
            size="small"
            fullWidth
            value={draft.sort}
            onChange={(event) => set({ sort: event.target.value as ListFilters['sort'] })}
            slotProps={{ htmlInput: { 'aria-label': 'Orden' } }}
          >
            <MenuItem value="recent">Más recientes primero</MenuItem>
            <MenuItem value="oldest">Más antiguas primero</MenuItem>
          </TextField>
        </Box>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'flex-end', p: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        <Button
          variant="contained"
          color="error"
          endIcon={<FilterAltOffOutlined />}
          onClick={() => {
            setDraft(NO_FILTERS)
            onApply(NO_FILTERS)
          }}
        >
          Limpiar filtros
        </Button>
        <Button
          variant="contained"
          color="success"
          endIcon={<FilterAltOutlined />}
          onClick={() => onApply(draft)}
        >
          Aplicar filtros
        </Button>
      </Stack>
    </Box>
  )
}
