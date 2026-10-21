import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined'
import { Avatar, Box, Button, Divider, Stack, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { Fragment } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import type { SharedContact } from '../../lib/api/inbox'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'
import { avatarColor, initials } from './inbox-format'

/** Contact cards shared in the chat ("Enviar contacto" in WhatsApp). */
export function ContactCards({
  contacts,
  incoming,
}: {
  contacts: SharedContact[]
  incoming: boolean
}) {
  const workspaceId = useActiveWorkspace().active?.id ?? ''
  const { has } = usePermissions()
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const save = useMutation({
    mutationFn: (contact: SharedContact) =>
      contactsApi.create(workspaceId, {
        name: contact.name,
        phone: contact.phones[0]?.phone ?? '',
        email: contact.emails[0] ?? null,
      }),
    onSuccess: (_, contact) => {
      enqueueSnackbar(`${contact.name} se agregó a tus contactos`, { variant: 'success' })
      void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'warning' }),
  })
  return (
    <Stack spacing={0.5} sx={{ minWidth: 220 }}>
      {contacts.map((contact, index) => (
        <Fragment key={`${contact.name}-${index}`}>
          {index > 0 && <Divider />}
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', py: 0.5 }}>
            <Avatar
              sx={{
                width: 40,
                height: 40,
                fontSize: 15,
                bgcolor: avatarColor(contact.phones[0]?.phone ?? contact.name),
              }}
            >
              {initials(contact.name)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600 }} noWrap>
                {contact.name}
              </Typography>
              {contact.organization && (
                <Typography variant="caption" component="div" noWrap>
                  {contact.organization}
                </Typography>
              )}
              {contact.phones.map((phone) => (
                <Typography key={phone.phone} variant="body2" color="text.secondary" noWrap>
                  {phone.phone}
                </Typography>
              ))}
            </Box>
          </Stack>
          {incoming && has('contacts.write') && contact.phones.length > 0 && (
            <Button
              size="small"
              startIcon={<PersonAddAlt1Outlined />}
              disabled={save.isPending}
              onClick={() => save.mutate(contact)}
            >
              Agregar a contactos
            </Button>
          )}
        </Fragment>
      ))}
    </Stack>
  )
}
