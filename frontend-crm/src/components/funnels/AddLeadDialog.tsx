import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { es } from '../../i18n/es'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { ApiError, errorMessage } from '../../lib/api/errors'
import type { FunnelStage } from '../../lib/api/funnels'
import type { Contact } from '../../lib/api/types'

const t = es.funnels.addLeadForm

/** «Agregar lead»: a contact into a stage. If it is already there, offers to open it. */
export function AddLeadDialog({
  workspaceId,
  stages,
  defaultStageId,
  onSubmit,
  onOpenExisting,
  onClose,
}: {
  workspaceId: string
  stages: FunnelStage[]
  defaultStageId?: string
  onSubmit: (contactId: string, stageId: string) => Promise<void>
  onOpenExisting: (contact: Contact) => void
  onClose: () => void
}) {
  const { has } = usePermissions()
  const [contact, setContact] = useState<Contact | null>(null)
  const [stageId, setStageId] = useState(defaultStageId ?? stages[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const options = useQuery({
    queryKey: [...contactKeys.all(workspaceId), 'pick', deferred],
    queryFn: () => contactsApi.list(workspaceId, { search: deferred || undefined }),
    enabled: has('contacts.read'),
  })

  const submit = async () => {
    if (!contact || !stageId) return
    setBusy(true)
    setError(null)
    setExists(false)
    try {
      await onSubmit(contact.id, stageId)
      onClose()
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.body?.code === 'LEAD_EXISTS') setExists(true)
      else setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {exists && contact && (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={() => onOpenExisting(contact)}>
                  {es.funnels.lead.open}
                </Button>
              }
            >
              {t.exists}
            </Alert>
          )}
          <Autocomplete
            options={options.data?.items ?? []}
            loading={options.isFetching}
            filterOptions={(items) => items}
            value={contact}
            getOptionLabel={(item) => item.name ?? item.phone}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, item) => (
              <li {...props} key={item.id}>
                <Stack>
                  <Typography>{item.name ?? item.phone}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.phone}
                  </Typography>
                </Stack>
              </li>
            )}
            onInputChange={(_, value) => setSearch(value)}
            onChange={(_, value) => {
              setContact(value)
              setExists(false)
            }}
            noOptionsText={t.noContacts}
            renderInput={(params) => (
              <TextField {...params} required label={t.contact} helperText={t.contactHelp} />
            )}
          />
          <TextField
            select
            required
            label={t.stage}
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
          >
            {stages.map((stage) => (
              <MenuItem key={stage.id} value={stage.id}>
                {stage.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !contact || !stageId}
        >
          {t.add}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
