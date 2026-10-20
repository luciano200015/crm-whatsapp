import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageHeader } from '../../../components/PageHeader'
import { TagChip } from '../../../components/contacts/TagChip'
import { TagDialog } from '../../../components/contacts/TagDialog'
import { useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import { contactKeys, contactsApi } from '../../../lib/api/contacts'
import { errorMessage } from '../../../lib/api/errors'
import type { Tag, TagRequest } from '../../../lib/api/types'

/** Contactos → Etiquetas. The route requires tags.manage. */
export function TagsPage() {
  useDocumentTitle(es.tags.title)
  const workspaceId = useWorkspaceId()
  const tags = useTags()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [editing, setEditing] = useState<Tag | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Tag | null>(null)

  // Contacts show tag names and colors too.
  const refresh = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })

  const save = async (values: TagRequest) => {
    if (editing && editing !== 'new') {
      await contactsApi.updateTag(workspaceId, editing.id, values)
      enqueueSnackbar(es.tags.updated, { variant: 'success' })
    } else {
      await contactsApi.createTag(workspaceId, values)
      enqueueSnackbar(es.tags.created, { variant: 'success' })
    }
    await refresh()
  }

  const remove = useMutation({
    mutationFn: (tag: Tag) => contactsApi.removeTag(workspaceId, tag.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(es.tags.deleted, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  return (
    <Stack spacing={2.5}>
      <PageHeader title={es.tags.title} subtitle={es.tags.subtitle} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing('new')}>
          {es.tags.newTag}
        </Button>
      </Box>

      {tags.isPending ? (
        <Skeleton variant="rounded" height={160} />
      ) : tags.isError ? (
        <Alert severity="error">{errorMessage(tags.error)}</Alert>
      ) : tags.data.length === 0 ? (
        <Alert severity="info">{es.tags.empty}</Alert>
      ) : (
        <Card variant="outlined">
          <List disablePadding>
            {tags.data.map((tag, index) => (
              <ListItem
                key={tag.id}
                divider={index < tags.data.length - 1}
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={es.tags.edit}>
                      <IconButton
                        aria-label={`${es.tags.edit} ${tag.name}`}
                        onClick={() => setEditing(tag)}
                      >
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={es.tags.delete}>
                      <IconButton
                        aria-label={`${es.tags.delete} ${tag.name}`}
                        onClick={() => setDeleting(tag)}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <ListItemText
                  primary={<TagChip tag={tag} />}
                  secondary={[es.tags.contacts(tag.contactCount), tag.description]
                    .filter(Boolean)
                    .join(' · ')}
                  slotProps={{ secondary: { sx: { mt: 0.75 } } }}
                />
              </ListItem>
            ))}
          </List>
        </Card>
      )}

      {editing && (
        <TagDialog
          tag={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={es.tags.deleteTitle}
        confirmLabel={es.tags.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && es.tags.confirmDelete(deleting.name, deleting.contactCount)}
      </ConfirmDialog>
    </Stack>
  )
}
