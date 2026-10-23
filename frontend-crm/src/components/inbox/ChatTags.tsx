import CheckBoxOutlineBlankRounded from '@mui/icons-material/CheckBoxOutlineBlankRounded'
import CheckBoxRounded from '@mui/icons-material/CheckBoxRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { Link } from 'react-router'
import { usePermissions } from '../../auth/usePermissions'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys, type Conversation } from '../../lib/api/inbox'
import { TagChip } from '../contacts/TagChip'

function useWorkspaceTags(workspaceId: string) {
  const { has } = usePermissions()
  return useQuery({
    queryKey: contactKeys.tags(workspaceId),
    queryFn: () => contactsApi.tags(workspaceId),
    enabled: !!workspaceId && has('contacts.read'),
  })
}

/** The tags of the chat (of its contact), under its name in the header. */
export function ChatTagChips({
  workspaceId,
  conversation,
}: {
  workspaceId: string
  conversation: Conversation
}) {
  const tags = useWorkspaceTags(workspaceId)
  const ids = conversation.contactTagIds ?? []
  const chosen = (tags.data ?? []).filter((tag) => ids.includes(tag.id))
  if (chosen.length === 0) return null
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
      {chosen.map((tag) => (
        <TagChip key={tag.id} tag={tag} sx={{ height: 20, fontSize: 11 }} />
      ))}
    </Stack>
  )
}

/**
 * "Etiquetar chat", as in wasapi: tick tags and they apply at once. They
 * are the contact's tags, so the list, the filters and Contactos agree.
 */
export function ChatTagPopover({
  workspaceId,
  conversation,
  anchorEl,
  onClose,
}: {
  workspaceId: string
  conversation: Conversation
  /** Opens the popover next to this element; null keeps it closed. */
  anchorEl: HTMLElement | null
  onClose: () => void
}) {
  const { has } = usePermissions()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [search, setSearch] = useState('')
  const tags = useWorkspaceTags(workspaceId)
  const save = useMutation({
    mutationFn: (tagIds: string[]) => inboxApi.setTags(workspaceId, conversation.id, tagIds),
    onSuccess: (updated) => {
      client.setQueryData(inboxKeys.conversation(workspaceId, conversation.id), updated)
      void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  const selected = (save.isPending ? save.variables : conversation.contactTagIds) ?? []
  const toggle = (id: string) =>
    save.mutate(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  const term = search.trim().toLowerCase()
  const shown = (tags.data ?? []).filter((tag) => tag.name.toLowerCase().includes(term))

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={() => {
        onClose()
        setSearch('')
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: { sx: { width: 300, mt: 0.5 }, role: 'dialog', 'aria-label': 'Etiquetar chat' },
      }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Etiquetar chat
        </Typography>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder="Buscar etiqueta"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Buscar etiqueta' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      {tags.error && (
        <Alert severity="warning" sx={{ mx: 1.5 }}>
          {errorMessage(tags.error)}
        </Alert>
      )}
      <List dense sx={{ maxHeight: 280, overflowY: 'auto', py: 0 }}>
        {shown.map((tag) => {
          const checked = selected.includes(tag.id)
          return (
            <ListItemButton
              key={tag.id}
              role="checkbox"
              aria-checked={checked}
              aria-label={tag.name}
              onClick={() => toggle(tag.id)}
            >
              <ListItemIcon sx={{ minWidth: 34, color: tag.color }}>
                {checked ? (
                  <CheckBoxRounded fontSize="small" />
                ) : (
                  <CheckBoxOutlineBlankRounded fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>
                <TagChip tag={tag} />
              </ListItemText>
            </ListItemButton>
          )
        })}
        {tags.isSuccess && shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            {tags.data.length === 0 ? 'Aún no hay etiquetas.' : 'Ninguna etiqueta coincide.'}
          </Typography>
        )}
      </List>
      {has('tags.manage') && (
        <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" component={Link} to="/contacts/tags">
            Administrar etiquetas
          </Button>
        </Box>
      )}
    </Popover>
  )
}
