import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { Can } from '../../../auth/permissions'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageHeader } from '../../../components/PageHeader'
import { ContactDialog } from '../../../components/contacts/ContactDialog'
import { TagChip } from '../../../components/contacts/TagChip'
import { useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import { contactKeys, contactsApi, type ContactFilter } from '../../../lib/api/contacts'
import { errorMessage } from '../../../lib/api/errors'
import type { Contact, ContactRequest } from '../../../lib/api/types'
import { formatDate } from '../../../lib/billing'
import { initials } from '../../../lib/team'

/** Contactos → Administrar. The route requires contacts.read. */
export function ContactsPage() {
  useDocumentTitle(es.contacts.title)
  const workspaceId = useWorkspaceId()
  const tags = useTags()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()

  const [search, setSearch] = useState('')
  const [tagId, setTagId] = useState('')
  const filter: ContactFilter = {
    search: useDeferredValue(search.trim()) || undefined,
    tagId: tagId || undefined,
  }
  const contacts = useInfiniteQuery({
    queryKey: contactKeys.list(workspaceId, filter),
    queryFn: ({ pageParam }) => contactsApi.list(workspaceId, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: workspaceId !== '',
    placeholderData: keepPreviousData,
  })
  const rows = contacts.data?.pages.flatMap((page) => page.items) ?? []

  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)

  // Tag counts change with contacts, so the whole contacts cache is refreshed.
  const refresh = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })

  const save = async (values: ContactRequest) => {
    if (editing && editing !== 'new') {
      await contactsApi.update(workspaceId, editing.id, values)
      enqueueSnackbar(es.contacts.updated, { variant: 'success' })
    } else {
      await contactsApi.create(workspaceId, values)
      enqueueSnackbar(es.contacts.created, { variant: 'success' })
    }
    await refresh()
  }

  const remove = useMutation({
    mutationFn: (contact: Contact) => contactsApi.remove(workspaceId, contact.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(es.contacts.deleted, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  return (
    <Stack spacing={2.5}>
      <PageHeader title={es.contacts.title} subtitle={es.contacts.subtitle} />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' } }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={es.contacts.search}
          slotProps={{
            htmlInput: { 'aria-label': es.contacts.search },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flexGrow: 1, maxWidth: { md: 380 } }}
        />
        <TextField
          select
          size="small"
          value={tagId}
          onChange={(event) => setTagId(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': es.contacts.tagFilter } }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{es.contacts.allTags}</MenuItem>
          {(tags.data ?? []).map((tag) => (
            <MenuItem key={tag.id} value={tag.id}>
              <TagChip tag={tag} />
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <Can anyOf={['contacts.write']}>
          <Button
            variant="contained"
            startIcon={<PersonAddAlt1Outlined />}
            onClick={() => setEditing('new')}
          >
            {es.contacts.newContact}
          </Button>
        </Can>
      </Stack>

      <Card variant="outlined">
        {contacts.isFetching && <LinearProgress sx={{ height: 2 }} />}
        <TableContainer>
          <Table sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>{es.contacts.columns.contact}</TableCell>
                <TableCell>{es.contacts.columns.phone}</TableCell>
                <TableCell>{es.contacts.columns.tags}</TableCell>
                <TableCell>{es.contacts.columns.source}</TableCell>
                <TableCell>{es.contacts.columns.lastMessage}</TableCell>
                <Can anyOf={['contacts.write']}>
                  <TableCell align="right">{es.contacts.columns.actions}</TableCell>
                </Can>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.isPending ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton variant="rounded" height={120} />
                  </TableCell>
                </TableRow>
              ) : contacts.isError ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Alert severity="error">{errorMessage(contacts.error)}</Alert>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}
                  >
                    {es.contacts.empty}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((contact) => {
                  const name = contact.name ?? es.contacts.noName
                  return (
                    <TableRow key={contact.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar
                            alt=""
                            sx={(theme) => ({
                              width: 36,
                              height: 36,
                              fontSize: 14,
                              background: theme.custom.gradient,
                            })}
                          >
                            {initials(contact.name ?? contact.phone)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography noWrap sx={{ fontWeight: 600 }}>
                              {name}
                            </Typography>
                            {contact.email && (
                              <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                                {contact.email}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {contact.phone}
                        <Can anyOf={['messages.read']}>
                          <Button
                            component={Link}
                            to={`/inbox?contactId=${encodeURIComponent(contact.id)}`}
                            size="small"
                          >
                            Ir al chat
                          </Button>
                        </Can>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                          {contact.tags.map((tag) => (
                            <TagChip key={tag.id} tag={tag} />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={contact.source === 'whatsapp' ? 'success' : 'default'}
                          label={es.contacts.source[contact.source]}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {contact.lastMessageAt
                          ? formatDate(contact.lastMessageAt)
                          : es.contacts.never}
                      </TableCell>
                      <Can anyOf={['contacts.write']}>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title={es.contacts.edit}>
                            <IconButton
                              aria-label={`${es.contacts.edit} ${name}`}
                              onClick={() => setEditing(contact)}
                            >
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={es.contacts.delete}>
                            <IconButton
                              aria-label={`${es.contacts.delete} ${name}`}
                              onClick={() => setDeleting(contact)}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </Can>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {contacts.hasNextPage && (
        <Box sx={{ textAlign: 'center' }}>
          <Button
            variant="outlined"
            onClick={() => void contacts.fetchNextPage()}
            disabled={contacts.isFetchingNextPage}
          >
            {es.contacts.loadMore}
          </Button>
        </Box>
      )}

      {editing && (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
          tags={tags.data ?? []}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={es.contacts.deleteTitle}
        confirmLabel={es.contacts.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && es.contacts.confirmDelete(deleting.name ?? deleting.phone)}
      </ConfirmDialog>
    </Stack>
  )
}
