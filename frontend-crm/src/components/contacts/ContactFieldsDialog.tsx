import AddRounded from '@mui/icons-material/AddRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { contactKeys, contactsApi, type ContactField, type FieldType } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import { ConfirmDialog } from '../ConfirmDialog'
import { useContactFields } from './useContacts'

const t = es.contacts.fields
const TYPES: FieldType[] = ['TEXT', 'NUMBER', 'DATE', 'SELECT']

interface Draft {
  id: string | null
  label: string
  type: FieldType
  options: string[]
}

/** «Administrar campos personalizados». Needs contacts.manage. */
export function ContactFieldsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const fields = useContactFields(workspaceId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<ContactField | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })

  const save = useMutation({
    mutationFn: (value: Draft) =>
      value.id
        ? contactsApi.updateField(workspaceId, value.id, {
            label: value.label,
            ...(value.type === 'SELECT' && { options: value.options }),
          })
        : contactsApi.createField(workspaceId, {
            label: value.label,
            type: value.type,
            ...(value.type === 'SELECT' && { options: value.options }),
          }),
    onSuccess: async () => {
      setDraft(null)
      setError(null)
      await refresh()
      enqueueSnackbar(t.saved, { variant: 'success' })
    },
    onError: (caught) => setError(errorMessage(caught)),
  })

  const remove = useMutation({
    mutationFn: (field: ContactField) => contactsApi.removeField(workspaceId, field.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(t.deleted, { variant: 'success' })
    },
    onError: (caught) => enqueueSnackbar(errorMessage(caught), { variant: 'error' }),
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t.intro}
          </Typography>
          {fields.isPending ? (
            <Skeleton variant="rounded" height={80} />
          ) : fields.isError ? (
            <Alert severity="error">{errorMessage(fields.error)}</Alert>
          ) : fields.data.length === 0 ? (
            <Typography color="text.secondary">{t.empty}</Typography>
          ) : (
            <List dense disablePadding>
              {fields.data.map((field) => (
                <ListItem
                  key={field.id}
                  divider
                  secondaryAction={
                    <>
                      <Tooltip title={t.edit}>
                        <IconButton
                          aria-label={`${t.edit} ${field.label}`}
                          onClick={() => {
                            setError(null)
                            setDraft({ ...field })
                          }}
                        >
                          <EditOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t.delete}>
                        <IconButton
                          aria-label={`${t.delete} ${field.label}`}
                          onClick={() => setDeleting(field)}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  }
                >
                  <ListItemText
                    primary={field.label}
                    secondary={`${t.types[field.type]}${
                      field.type === 'SELECT' ? ` · ${field.options.join(', ')}` : ''
                    } · ${t.keyHelp(field.key)}`}
                  />
                </ListItem>
              ))}
            </List>
          )}

          {draft ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    autoFocus
                    fullWidth
                    label={t.label}
                    value={draft.label}
                    onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                  />
                  <TextField
                    select
                    label={t.type}
                    value={draft.type}
                    disabled={!!draft.id}
                    onChange={(event) =>
                      setDraft({ ...draft, type: event.target.value as FieldType })
                    }
                    sx={{ minWidth: 190 }}
                  >
                    {TYPES.map((type) => (
                      <MenuItem key={type} value={type}>
                        {t.types[type]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {draft.type === 'SELECT' && (
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={draft.options}
                    onChange={(_, values) =>
                      setDraft({ ...draft, options: values.map((value) => value.trim()) })
                    }
                    renderValue={(values, getItemProps) =>
                      values.map((value, index) => {
                        const { key, ...itemProps } = getItemProps({ index })
                        return <Chip key={key} size="small" label={value} {...itemProps} />
                      })
                    }
                    renderInput={(params) => (
                      <TextField {...params} label={t.options} helperText={t.optionsHelp} />
                    )}
                  />
                )}
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setDraft(null)} disabled={save.isPending}>
                    {es.common.cancel}
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    disabled={save.isPending || !draft.label.trim()}
                    onClick={() => save.mutate(draft)}
                  >
                    {es.contacts.form.save}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ) : (
            <Button
              startIcon={<AddRounded />}
              onClick={() => {
                setError(null)
                setDraft({ id: null, label: '', type: 'TEXT', options: [] })
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t.add}
            </Button>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{es.common.close}</Button>
      </DialogActions>
      <ConfirmDialog
        open={deleting !== null}
        title={t.deleteTitle}
        confirmLabel={t.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && t.confirmDelete(deleting.label)}
      </ConfirmDialog>
    </Dialog>
  )
}
