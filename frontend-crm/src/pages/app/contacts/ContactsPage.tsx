import BlockRounded from '@mui/icons-material/BlockRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
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
import { usePermissions } from '../../../auth/usePermissions'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageHeader } from '../../../components/PageHeader'
import {
  BlockContactDialog,
  type BlockTarget,
} from '../../../components/contacts/BlockContactDialog'
import { ContactDialog } from '../../../components/contacts/ContactDialog'
import { ContactFieldsDialog } from '../../../components/contacts/ContactFieldsDialog'
import { ImportContactsDialog } from '../../../components/contacts/ImportContactsDialog'
import { TagChip } from '../../../components/contacts/TagChip'
import { useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import {
  contactKeys,
  contactsApi,
  type ContactFilter,
  type ContactStatus,
} from '../../../lib/api/contacts'
import { errorMessage } from '../../../lib/api/errors'
import type { Contact, Tag } from '../../../lib/api/types'
import { formatDate } from '../../../lib/billing'
import { download } from '../../../lib/spreadsheet'
import { initials } from '../../../lib/team'

const t = es.contacts

type Dialogs =
  | { kind: 'edit'; contact: Contact | null }
  | { kind: 'import' }
  | { kind: 'fields' }
  | { kind: 'deleteAll' }
  | { kind: 'bulkTags'; add: boolean }
  | { kind: 'bulkDelete' }
  | null

/** Contactos → Administrar, like wasapi. The route requires contacts.read. */
export function ContactsPage() {
  useDocumentTitle(t.title)
  const workspaceId = useWorkspaceId()
  const tags = useTags()
  const { has } = usePermissions()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const canWrite = has('contacts.write')

  const [search, setSearch] = useState('')
  const [tagId, setTagId] = useState('')
  const [status, setStatus] = useState<ContactStatus | ''>('')
  const filter: ContactFilter = {
    search: useDeferredValue(search.trim()) || undefined,
    tagId: tagId || undefined,
    status: status || undefined,
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

  const [dialog, setDialog] = useState<Dialogs>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const [blocking, setBlocking] = useState<BlockTarget | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const visibleSelected = rows.filter((row) => selected.has(row.id))
  const allSelected = rows.length > 0 && visibleSelected.length === rows.length

  // Tag counts change with contacts, so the whole contacts cache is refreshed.
  const refresh = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
  const fail = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })

  const remove = useMutation({
    mutationFn: (contact: Contact) => contactsApi.remove(workspaceId, contact.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(t.deleted, { variant: 'success' })
    },
    onError: fail,
  })

  const bulk = useMutation({
    mutationFn: (request: { action: 'add_tags' | 'remove_tags' | 'delete'; tagIds?: string[] }) =>
      contactsApi.bulk(workspaceId, { contactIds: [...selected], ...request }),
    onSuccess: async ({ affected }, request) => {
      setDialog(null)
      setSelected(new Set())
      await refresh()
      enqueueSnackbar(
        request.action === 'delete' ? t.bulkDeleted(affected) : t.bulkDone(affected),
        { variant: 'success' },
      )
    },
    onError: fail,
  })

  const removeAll = useMutation({
    mutationFn: () => contactsApi.removeAll(workspaceId),
    onSuccess: async ({ deleted }) => {
      setDialog(null)
      setSelected(new Set())
      await refresh()
      enqueueSnackbar(t.deleteAll.done(deleted), { variant: 'success' })
    },
    onError: fail,
  })

  const exportCsv = async (filtered: boolean) => {
    setMoreAnchor(null)
    try {
      const blob = await contactsApi.exportCsv(workspaceId, filtered ? filter : {})
      download(blob, filtered ? 'contactos-filtrados.csv' : 'contactos.csv')
      enqueueSnackbar(t.exported, { variant: 'success' })
    } catch (error: unknown) {
      fail(error)
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filtered = !!(filter.search || filter.tagId || filter.status)
  const columns = canWrite ? 8 : 7

  return (
    <Stack spacing={2.5}>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' } }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.search}
          slotProps={{
            htmlInput: { 'aria-label': t.search },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flexGrow: 1, maxWidth: { md: 340 } }}
        />
        <TextField
          select
          size="small"
          value={tagId}
          onChange={(event) => setTagId(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': t.tagFilter },
            select: { displayEmpty: true },
          }}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="">{t.allTags}</MenuItem>
          {(tags.data ?? []).map((tag) => (
            <MenuItem key={tag.id} value={tag.id}>
              <TagChip tag={tag} />
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          value={status}
          onChange={(event) => setStatus(event.target.value as ContactStatus | '')}
          slotProps={{
            htmlInput: { 'aria-label': t.statusFilter },
            select: { displayEmpty: true },
          }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">{t.allStatuses}</MenuItem>
          <MenuItem value="ACTIVE">{t.status.ACTIVE}</MenuItem>
          <MenuItem value="BLOCKED">{t.status.BLOCKED}</MenuItem>
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <Can anyOf={['contacts.manage']}>
          <Button
            variant="outlined"
            endIcon={<ExpandMoreRounded />}
            aria-haspopup="menu"
            onClick={(event) => setMoreAnchor(event.currentTarget)}
          >
            {t.more.button}
          </Button>
        </Can>
        <Can anyOf={['contacts.write']}>
          <Button
            variant="contained"
            color="success"
            startIcon={<PersonAddAlt1Outlined />}
            onClick={() => setDialog({ kind: 'edit', contact: null })}
          >
            {t.newContact}
          </Button>
        </Can>
      </Stack>
      <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null)
            setDialog({ kind: 'import' })
          }}
        >
          {t.more.import}
        </MenuItem>
        <MenuItem onClick={() => void exportCsv(false)}>{t.more.exportAll}</MenuItem>
        <MenuItem disabled={!filtered} onClick={() => void exportCsv(true)}>
          {t.more.exportFiltered}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null)
            setDialog({ kind: 'fields' })
          }}
        >
          {t.more.fields}
        </MenuItem>
        <Divider />
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setMoreAnchor(null)
            setDialog({ kind: 'deleteAll' })
          }}
        >
          {t.more.deleteAll}
        </MenuItem>
      </Menu>

      {canWrite && selected.size > 0 && (
        <Paper
          variant="outlined"
          sx={{ px: 2, py: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
        >
          <Typography sx={{ fontWeight: 600, mr: 1 }}>{t.selected(selected.size)}</Typography>
          <Button size="small" onClick={() => setDialog({ kind: 'bulkTags', add: true })}>
            {t.addTags}
          </Button>
          <Button size="small" onClick={() => setDialog({ kind: 'bulkTags', add: false })}>
            {t.removeTags}
          </Button>
          <Button size="small" color="error" onClick={() => setDialog({ kind: 'bulkDelete' })}>
            {t.deleteSelected}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => setSelected(new Set())}>
            {t.clearSelection}
          </Button>
        </Paper>
      )}

      <Card variant="outlined">
        {contacts.isFetching && <LinearProgress sx={{ height: 2 }} />}
        <TableContainer>
          <Table sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                {canWrite && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={visibleSelected.length > 0 && !allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
                      }
                      slotProps={{ input: { 'aria-label': t.selectAll } }}
                    />
                  </TableCell>
                )}
                <TableCell>{t.columns.contact}</TableCell>
                <TableCell>{t.columns.phone}</TableCell>
                <TableCell>{t.columns.tags}</TableCell>
                <TableCell>{t.columns.createdAt}</TableCell>
                <TableCell>{t.columns.updatedAt}</TableCell>
                <TableCell>{t.columns.status}</TableCell>
                <TableCell align="right">{t.columns.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.isPending ? (
                <TableRow>
                  <TableCell colSpan={columns}>
                    <Skeleton variant="rounded" height={120} />
                  </TableCell>
                </TableRow>
              ) : contacts.isError ? (
                <TableRow>
                  <TableCell colSpan={columns}>
                    <Alert severity="error">{errorMessage(contacts.error)}</Alert>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns}
                    sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}
                  >
                    {t.empty}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((contact) => {
                  const name = contact.name ?? t.noName
                  return (
                    <TableRow key={contact.id} hover selected={selected.has(contact.id)}>
                      {canWrite && (
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selected.has(contact.id)}
                            onChange={() => toggle(contact.id)}
                            slotProps={{ input: { 'aria-label': t.select(name) } }}
                          />
                        </TableCell>
                      )}
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
                            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                              {contact.email ?? t.source[contact.source]}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {contact.phone}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                          {contact.tags.map((tag) => (
                            <TagChip key={tag.id} tag={tag} />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {formatDate(contact.createdAt)}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {formatDate(contact.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={contact.blocked ? 'error' : 'success'}
                          label={contact.blocked ? t.status.BLOCKED : t.status.ACTIVE}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Can anyOf={['contacts.write']}>
                          <Tooltip title={t.edit}>
                            <IconButton
                              aria-label={`${t.edit} ${name}`}
                              onClick={() => setDialog({ kind: 'edit', contact })}
                            >
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Can>
                        <Can anyOf={['messages.read']}>
                          <Tooltip title={contact.lastMessageAt ? t.startChat : t.noChatYet}>
                            <span>
                              <IconButton
                                component={Link}
                                to={`/inbox?contactId=${encodeURIComponent(contact.id)}`}
                                aria-label={`${t.startChat} con ${name}`}
                                disabled={!contact.lastMessageAt}
                              >
                                <ForumOutlined fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Can>
                        <Can anyOf={['contacts.write']}>
                          <Tooltip title={contact.blocked ? t.unblock : t.block}>
                            <IconButton
                              aria-label={`${contact.blocked ? t.unblock : t.block} ${name}`}
                              onClick={() =>
                                setBlocking({ id: contact.id, name, blocked: !!contact.blocked })
                              }
                            >
                              <BlockRounded
                                fontSize="small"
                                color={contact.blocked ? 'error' : 'inherit'}
                              />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t.delete}>
                            <IconButton
                              aria-label={`${t.delete} ${name}`}
                              onClick={() => setDeleting(contact)}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Can>
                      </TableCell>
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
            {t.loadMore}
          </Button>
        </Box>
      )}

      {dialog?.kind === 'edit' && (
        <ContactDialog
          workspaceId={workspaceId}
          contact={dialog.contact}
          onClose={() => setDialog(null)}
          onSaved={(_, created) => {
            void refresh()
            enqueueSnackbar(created ? t.created : t.updated, { variant: 'success' })
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportContactsDialog workspaceId={workspaceId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'fields' && (
        <ContactFieldsDialog workspaceId={workspaceId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'deleteAll' && (
        <DeleteAllDialog
          loading={removeAll.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => removeAll.mutate()}
        />
      )}
      {dialog?.kind === 'bulkTags' && (
        <BulkTagsDialog
          add={dialog.add}
          count={selected.size}
          tags={tags.data ?? []}
          loading={bulk.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(tagIds) =>
            bulk.mutate({ action: dialog.add ? 'add_tags' : 'remove_tags', tagIds })
          }
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === 'bulkDelete'}
        title={t.bulkDeleteTitle}
        confirmLabel={t.deleteSelected}
        danger
        loading={bulk.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => bulk.mutate({ action: 'delete' })}
      >
        {t.bulkDeleteText(selected.size)}
      </ConfirmDialog>
      <BlockContactDialog
        workspaceId={workspaceId}
        contact={blocking}
        onClose={() => setBlocking(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t.deleteTitle}
        confirmLabel={t.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && t.confirmDelete(deleting.name ?? deleting.phone)}
      </ConfirmDialog>
    </Stack>
  )
}

/** «Eliminar todos los contactos»: typing ELIMINAR unlocks the button. */
function DeleteAllDialog({
  loading,
  onClose,
  onConfirm,
}: {
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const [text, setText] = useState('')
  return (
    <Dialog open onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.deleteAll.title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t.deleteAll.text}</DialogContentText>
        <TextField
          autoFocus
          fullWidth
          label={t.deleteAll.confirmLabel}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={loading || text !== 'ELIMINAR'}
          onClick={onConfirm}
        >
          {t.deleteAll.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Adds or removes tags on the selected contacts. */
function BulkTagsDialog({
  add,
  count,
  tags,
  loading,
  onClose,
  onConfirm,
}: {
  add: boolean
  count: number
  tags: Tag[]
  loading: boolean
  onClose: () => void
  onConfirm: (tagIds: string[]) => void
}) {
  const [chosen, setChosen] = useState<Tag[]>([])
  return (
    <Dialog open onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.bulkTagsTitle(add)}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t.bulkTagsHelp(count, add)}</DialogContentText>
        <Autocomplete
          multiple
          options={tags}
          value={chosen}
          onChange={(_, values) => setChosen(values)}
          getOptionLabel={(tag) => tag.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label={t.columns.tags} />}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          disabled={loading || chosen.length === 0}
          onClick={() => onConfirm(chosen.map((tag) => tag.id))}
        >
          {t.bulkTagsTitle(add)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
