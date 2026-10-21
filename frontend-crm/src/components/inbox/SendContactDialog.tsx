import CloseRounded from '@mui/icons-material/CloseRounded'
import {
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

export interface OutgoingContact {
  name: string
  phone: string
}

const MAX_CONTACTS = 5
const PHONE = /^\+?[\d\s()-]{6,24}$/

/** Pick up to 5 contacts (from the CRM or typed) to send as contact cards. */
export function SendContactDialog({
  sending,
  onClose,
  onSend,
}: {
  sending: boolean
  onClose: () => void
  onSend: (contacts: OutgoingContact[]) => void
}) {
  const workspaceId = useActiveWorkspace().active?.id ?? ''
  const { has } = usePermissions()
  const [chosen, setChosen] = useState<OutgoingContact[]>([])
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const deferred = useDeferredValue(search)
  const options = useQuery({
    queryKey: [...contactKeys.all(workspaceId), 'pick', deferred],
    queryFn: () => contactsApi.list(workspaceId, { search: deferred || undefined }),
    enabled: !!workspaceId && has('contacts.read'),
  })
  const full = chosen.length >= MAX_CONTACTS
  const add = (contact: OutgoingContact) => {
    if (full || chosen.some((item) => item.phone === contact.phone)) return
    setChosen([...chosen, contact])
  }
  const phoneError = phone.trim() && !PHONE.test(phone.trim()) ? 'Número no válido' : null
  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Enviar contacto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {has('contacts.read') && (
            <Autocomplete
              options={options.data?.items ?? []}
              loading={options.isFetching}
              filterOptions={(items) => items}
              getOptionLabel={(contact) => contact.name ?? contact.phone}
              renderOption={(props, contact) => (
                <li {...props} key={contact.id}>
                  <Stack>
                    <Typography>{contact.name ?? contact.phone}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {contact.phone}
                    </Typography>
                  </Stack>
                </li>
              )}
              onInputChange={(_, value) => setSearch(value)}
              onChange={(_, contact) => {
                if (contact) add({ name: contact.name ?? contact.phone, phone: contact.phone })
              }}
              value={null}
              disabled={full}
              noOptionsText="Sin coincidencias"
              renderInput={(params) => <TextField {...params} label="Buscar en tus contactos" />}
            />
          )}
          <Divider>o escribe uno nuevo</Divider>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Nombre"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={full}
              fullWidth
            />
            <TextField
              label="Teléfono"
              placeholder="+591 71234567"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              error={!!phoneError}
              helperText={phoneError ?? 'Con código de país'}
              disabled={full}
              fullWidth
            />
            <Button
              disabled={full || !name.trim() || !phone.trim() || !!phoneError}
              onClick={() => {
                add({ name: name.trim(), phone: phone.trim() })
                setName('')
                setPhone('')
              }}
              sx={{ alignSelf: { sm: 'flex-start' }, mt: { sm: 1 } }}
            >
              Agregar
            </Button>
          </Stack>
          {chosen.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {chosen.map((contact) => (
                <Chip
                  key={contact.phone}
                  label={`${contact.name} · ${contact.phone}`}
                  onDelete={() => setChosen(chosen.filter((item) => item !== contact))}
                  deleteIcon={<CloseRounded aria-label={`Quitar ${contact.name}`} />}
                />
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            Hasta {MAX_CONTACTS} contactos. El cliente podrá guardarlos o escribirles desde
            WhatsApp.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={sending || chosen.length === 0}
          onClick={() => onSend(chosen)}
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
