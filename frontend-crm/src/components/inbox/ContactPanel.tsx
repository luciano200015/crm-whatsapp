import { Alert, Autocomplete, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { usePermissions } from '../../auth/usePermissions'
import { contactsApi, contactKeys } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import type { Conversation } from '../../lib/api/inbox'
import { TagChip } from '../contacts/TagChip'

export function ContactPanel({
  workspaceId,
  conversation,
}: {
  workspaceId: string
  conversation: Conversation
}) {
  const { has } = usePermissions()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const key = [...contactKeys.all(workspaceId), 'detail', conversation.contactId]
  const contact = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => contactsApi.get(workspaceId, conversation.contactId, signal),
    enabled: has('contacts.read'),
  })
  const tags = useQuery({
    queryKey: contactKeys.tags(workspaceId),
    queryFn: () => contactsApi.tags(workspaceId),
    enabled: has('contacts.read') && has('contacts.write'),
  })
  const save = useMutation({
    mutationFn: (tagIds: string[]) =>
      contactsApi.update(workspaceId, conversation.contactId, { tagIds }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  return (
    <Paper variant="outlined" sx={{ p: 2, alignSelf: 'start' }}>
      <Stack spacing={2}>
        <Typography variant="h6">Contacto</Typography>
        <Typography>{contact.data?.name ?? conversation.contact.name ?? 'Sin nombre'}</Typography>
        <Typography variant="body2">{conversation.contact.phone}</Typography>
        {contact.error && <Alert severity="warning">{errorMessage(contact.error)}</Alert>}
        {contact.data?.email && <Typography variant="body2">{contact.data.email}</Typography>}
        {contact.data && has('contacts.write') && has('contacts.read') ? (
          <Autocomplete
            multiple
            options={tags.data ?? []}
            value={(tags.data ?? []).filter((tag) =>
              contact.data?.tags.some((selected) => selected.id === tag.id),
            )}
            getOptionLabel={(tag) => tag.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            disabled={save.isPending || tags.isPending || !!tags.error}
            onChange={(_, values) => save.mutate(values.map((tag) => tag.id))}
            renderInput={(props) => <TextField {...props} label="Etiquetas" />}
          />
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }} useFlexGap>
            {contact.data?.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </Stack>
        )}
        {tags.error && <Alert severity="warning">{errorMessage(tags.error)}</Alert>}
        {contact.data?.notes && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {contact.data.notes}
          </Typography>
        )}
        <Chip size="small" label={conversation.assignee?.name ?? 'Sin agente asignado'} />
      </Stack>
    </Paper>
  )
}
