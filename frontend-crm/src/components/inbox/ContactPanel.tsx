import CloseRounded from '@mui/icons-material/CloseRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState, type ReactNode } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { es } from '../../i18n/es'
import { useChatSettings } from '../../lib/api/chat-settings'
import { contactsApi, contactKeys } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys, type Conversation } from '../../lib/api/inbox'
import { ContactDialog } from '../contacts/ContactDialog'
import { TagChip } from '../contacts/TagChip'
import { useContactFields } from '../contacts/useContacts'
import { ContactFunnels } from '../funnels/ContactFunnels'
import { useContactFunnels } from '../funnels/useFunnels'
import { ContactAvatar } from './ConversationList'
import { contactName, STATUS_LABELS } from './inbox-format'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="overline" color="text.secondary" component="h3">
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/** Contact info beside the chat: tags, notes, agent and status, like wasapi's side panel. */
export function ContactPanel({
  workspaceId,
  conversation,
  onClose,
  children,
}: {
  workspaceId: string
  conversation: Conversation
  /** Hides the panel (its ✕). */
  onClose?: () => void
  /** Extra actions (e.g. block contact). */
  children?: ReactNode
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
  const funnels = useContactFunnels(workspaceId, conversation.contactId, conversation.lineId)
  const settings = useChatSettings(workspaceId)
  const fields = useContactFields(workspaceId, has('contacts.read'))
  const [editing, setEditing] = useState(false)
  const canWrite = has('contacts.write') && has('contacts.read')
  // «Asignación de asesores» of the contact, for this chat's line.
  const agentsKey = contactKeys.agents(workspaceId, conversation.contactId)
  const assignments = useQuery({
    queryKey: agentsKey,
    queryFn: () => contactsApi.agents(workspaceId, conversation.contactId),
    enabled: canWrite,
  })
  const line = assignments.data?.find((option) => option.lineId === conversation.lineId)
  const setAgent = useMutation({
    mutationFn: (membershipId: string | null) =>
      contactsApi.setAgents(workspaceId, conversation.contactId, [
        { lineId: conversation.lineId, membershipId },
      ]),
    onSuccess: (updated) => {
      client.setQueryData(key, updated)
      void client.invalidateQueries({ queryKey: agentsKey })
      enqueueSnackbar('Agente regular guardado.', { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  const fieldValues = (fields.data ?? []).flatMap((field) => {
    const value = contact.data?.fields?.[field.key]
    return value === undefined ? [] : [{ field, value }]
  })
  const save = useMutation({
    // Through the chat, so the list and the header show the new tags at once.
    mutationFn: (tagIds: string[]) => inboxApi.setTags(workspaceId, conversation.id, tagIds),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
      void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  return (
    <Box component="aside" aria-label="Detalles del contacto">
      {onClose && (
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            px: 2,
            minHeight: 64,
            borderBottom: 1,
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            zIndex: 1,
            bgcolor: 'background.paper',
          }}
        >
          <Typography sx={{ flex: 1, fontWeight: 600 }}>Detalles</Typography>
          <IconButton aria-label="Cerrar detalles" onClick={onClose} edge="end">
            <CloseRounded />
          </IconButton>
        </Stack>
      )}
      <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', px: 2, py: 3 }}>
        <ContactAvatar contact={conversation.contact} size={88} />
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
          {contact.data?.name ?? contactName(conversation.contact)}
        </Typography>
        {canWrite && contact.data && (
          <Button size="small" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>
            Editar contacto
          </Button>
        )}
        <Typography variant="body2" color="text.secondary">
          {conversation.contact.phone}
        </Typography>
        {contact.data?.email && (
          <Typography variant="body2" color="text.secondary">
            {contact.data.email}
          </Typography>
        )}
        <Stack direction="row" spacing={1}>
          <Chip
            size="small"
            color={
              conversation.status === 'OPEN'
                ? 'success'
                : conversation.status === 'ON_HOLD'
                  ? 'warning'
                  : 'default'
            }
            label={STATUS_LABELS[conversation.status]}
          />
          <Chip
            size="small"
            variant="outlined"
            label={conversation.lineName ?? 'Línea eliminada'}
          />
        </Stack>
      </Stack>
      <Divider />
      {contact.error && (
        <Alert severity="warning" sx={{ m: 2 }}>
          {errorMessage(contact.error)}
        </Alert>
      )}
      <Section title="Agente asignado">
        <Typography>{conversation.assignee?.name ?? 'Sin asignar'}</Typography>
      </Section>
      <Divider />
      {canWrite && line && (
        <>
          <Section title="Agente regular">
            <TextField
              select
              fullWidth
              size="small"
              value={line.agentMembershipId ?? ''}
              onChange={(event) => setAgent.mutate(event.target.value || null)}
              disabled={setAgent.isPending}
              slotProps={{
                htmlInput: { 'aria-label': 'Agente regular' },
                select: { displayEmpty: true },
              }}
              sx={{ mt: 0.5 }}
            >
              <MenuItem value="">
                <em>Sin agente regular</em>
              </MenuItem>
              {line.agents.map((agent) => (
                <MenuItem key={agent.membershipId} value={agent.membershipId}>
                  {agent.name}
                </MenuItem>
              ))}
            </TextField>
            {line.attending && line.attending.membershipId !== line.agentMembershipId && (
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center', mt: 0.75, color: 'text.secondary' }}
              >
                <SwapHorizRounded sx={{ fontSize: 16 }} />
                <Typography variant="caption">
                  {es.contacts.form.attending(line.attending.name)}
                </Typography>
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {settings.data?.assignment.mode === 'CONTACT_AGENT'
                ? `Recibe los chats nuevos de este contacto en ${line.name}.`
                : 'Recibe sus chats nuevos con «Asignar según el agente registrado».'}
            </Typography>
          </Section>
          <Divider />
        </>
      )}
      <Section title="Etiquetas">
        {contact.data && has('contacts.write') && has('contacts.read') ? (
          <Autocomplete
            multiple
            size="small"
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
            {contact.data?.tags.length ? (
              contact.data.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sin etiquetas
              </Typography>
            )}
          </Stack>
        )}
        {tags.error && <Alert severity="warning">{errorMessage(tags.error)}</Alert>}
      </Section>
      {!!funnels.query.data?.length && (
        <>
          <Divider />
          <Section title={es.funnels.chat.funnels}>
            <ContactFunnels
              workspaceId={workspaceId}
              contactId={conversation.contactId}
              lineId={conversation.lineId}
            />
          </Section>
        </>
      )}
      {fieldValues.length > 0 && (
        <>
          <Divider />
          <Section title={es.contacts.form.customFields}>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {fieldValues.map(({ field, value }) => (
                <Box key={field.id}>
                  <Typography variant="caption" color="text.secondary">
                    {field.label}
                  </Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {field.type === 'DATE'
                      ? new Date(`${value}T00:00:00`).toLocaleDateString('es')
                      : String(value)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Section>
        </>
      )}
      {contact.data?.notes && (
        <>
          <Divider />
          <Section title="Notas del contacto">
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {contact.data.notes}
            </Typography>
          </Section>
        </>
      )}
      <Divider />
      <Section title="Conversación">
        <Typography variant="body2">
          Iniciada el {new Date(conversation.createdAt).toLocaleString('es')}
        </Typography>
        {conversation.closedAt && (
          <Typography variant="body2">
            Cerrada el {new Date(conversation.closedAt).toLocaleString('es')}
          </Typography>
        )}
        <Typography
          variant="body2"
          color={conversation.windowOpen ? 'success.main' : 'text.secondary'}
        >
          {conversation.windowOpen && conversation.windowExpiresAt
            ? `Puedes responder hasta las ${new Date(conversation.windowExpiresAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
            : 'Ventana de 24 h cerrada'}
        </Typography>
      </Section>
      {children && (
        <>
          <Divider />
          <Box sx={{ p: 2 }}>{children}</Box>
        </>
      )}
      {editing && contact.data && (
        <ContactDialog
          workspaceId={workspaceId}
          contact={contact.data}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            client.setQueryData(key, updated)
            void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
            void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
            enqueueSnackbar(es.contacts.updated, { variant: 'success' })
          }}
        />
      )}
    </Box>
  )
}
