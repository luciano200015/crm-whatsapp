import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState, type ReactNode } from 'react'
import { usePermissions } from '../../auth/usePermissions'
import { channelKeys, channelsApi } from '../../lib/api/channels'
import {
  chatSettingsApi,
  chatSettingsKeys,
  useChatSettings,
  type AssignmentMode,
  type ChatSettings,
  type CloseMessageMode,
  type SignatureMode,
} from '../../lib/api/chat-settings'
import { errorMessage } from '../../lib/api/errors'
import { inboxApi, inboxKeys, type Assignee } from '../../lib/api/inbox'
import { AlertPreferences } from './AlertSettings'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
      )}
      {children}
    </Box>
  )
}

function Choice({ value, label, help }: { value: string; label: string; help?: string }) {
  return (
    <FormControlLabel
      value={value}
      control={<Radio />}
      sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { pt: 0.5 } }}
      label={
        <Box sx={{ py: 0.5 }}>
          <Typography>{label}</Typography>
          {help && (
            <Typography variant="body2" color="text.secondary">
              {help}
            </Typography>
          )}
        </Box>
      }
    />
  )
}

/**
 * «Configuración del módulo de chat», as in wasapi: alerts for everyone;
 * auto-assignment, line agents, transfers, signature and the closing
 * message for who manages the lines.
 */
export function ChatSettingsDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string
  open: boolean
  onClose: () => void
}) {
  const { has } = usePermissions()
  const manage = has('channels.manage')
  const settings = useChatSettings(workspaceId)
  const lines = useQuery({
    queryKey: inboxKeys.assignment(workspaceId),
    queryFn: ({ signal }) => inboxApi.assignment(workspaceId, signal),
    enabled: open && manage,
  })
  const ready = !manage || (!!settings.data && !!lines.data)
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>Configuración del módulo de chat</DialogTitle>
      {!ready ? (
        <DialogContent>
          {settings.error || lines.error ? (
            <Alert severity="error">{errorMessage(settings.error ?? lines.error)}</Alert>
          ) : (
            <LinearProgress />
          )}
        </DialogContent>
      ) : manage && settings.data && lines.data ? (
        <SettingsForm
          // A fresh form each time it opens, with what is saved.
          key={`${settings.dataUpdatedAt}:${lines.dataUpdatedAt}`}
          workspaceId={workspaceId}
          initial={settings.data}
          legacy={settings.data.legacyAssignment}
          lines={lines.data.lines}
          members={lines.data.members}
          onClose={onClose}
        />
      ) : (
        <>
          <DialogContent dividers>
            <Section title="Avisos de mensajes nuevos">
              <AlertPreferences />
            </Section>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cerrar</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

type LineAgents = { id: string; name: string; status: string; membershipIds: string[] }

function SettingsForm({
  workspaceId,
  initial,
  legacy,
  lines,
  members,
  onClose,
}: {
  workspaceId: string
  initial: ChatSettings
  legacy: boolean
  lines: LineAgents[]
  members: Assignee[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [form, setForm] = useState<ChatSettings>({
    assignment: { ...initial.assignment },
    transfers: initial.transfers,
    signature: initial.signature,
    closeMessage: { ...initial.closeMessage },
  })
  const [agents, setAgents] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.membershipIds])),
  )
  const closeText = form.closeMessage.text.trim()
  const closeTextMissing = form.closeMessage.mode !== 'NEVER' && !closeText

  const save = useMutation({
    mutationFn: async () => {
      for (const line of lines) {
        const chosen = agents[line.id] ?? []
        const same =
          chosen.length === line.membershipIds.length &&
          chosen.every((id) => line.membershipIds.includes(id))
        if (!same) await channelsApi.setAgents(workspaceId, line.id, chosen)
      }
      return chatSettingsApi.update(workspaceId, form)
    },
    onSuccess: (saved) => {
      client.setQueryData(chatSettingsKeys.all(workspaceId), saved)
      enqueueSnackbar('Configuración del chat guardada.', { variant: 'success' })
      onClose()
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      void client.invalidateQueries({ queryKey: inboxKeys.assignment(workspaceId) })
      void client.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
    },
  })
  const busy = save.isPending

  return (
    <>
      <DialogContent dividers>
        <Stack spacing={3} divider={<Divider flexItem />}>
          <Section
            title="Auto-asignación de chats"
            description="Cómo llegan los chats nuevos a los agentes."
          >
            {legacy && (
              <Alert severity="info" sx={{ mb: 1 }}>
                Hoy cada línea usa su propio interruptor de autoasignación por turnos. Al guardar,
                esta configuración se aplica a todas las líneas.
              </Alert>
            )}
            <RadioGroup
              value={form.assignment.mode}
              onChange={(_, mode) =>
                setForm({
                  ...form,
                  assignment: { ...form.assignment, mode: mode as AssignmentMode },
                })
              }
            >
              <Choice
                value="NONE"
                label="No habilitado"
                help="Los chats nuevos quedan sin asignar y los agentes los toman."
              />
              <Choice
                value="LEAST_BUSY"
                label="Autoasignar conversación"
                help="Al agente de la línea con menos chats abiertos entre los que tienen la bandeja abierta. Si no hay nadie conectado, el chat espera sin asignar."
              />
              <Choice
                value="CONTACT_AGENT"
                label="Asignar según el agente registrado"
                help="Al agente regular del contacto (se elige en el panel del contacto). Sin agente regular, se autoasigna como en la opción anterior."
              />
            </RadioGroup>
            {form.assignment.mode !== 'NONE' && (
              <FormControlLabel
                sx={{ ml: 3 }}
                control={
                  <Checkbox
                    checked={form.assignment.includeAdmins}
                    onChange={(_, includeAdmins) =>
                      setForm({ ...form, assignment: { ...form.assignment, includeAdmins } })
                    }
                  />
                }
                label="Incluir a los administradores de la cuenta en la asignación de chats"
              />
            )}
          </Section>

          <Section
            title="Agentes de cada línea"
            description="Quiénes atienden cada línea: ven sus chats y reciben los autoasignados."
          >
            <Stack spacing={2}>
              {lines.length === 0 && (
                <Typography color="text.secondary">Aún no tienes líneas configuradas.</Typography>
              )}
              {lines.map((line) => (
                <Autocomplete
                  key={line.id}
                  multiple
                  options={members}
                  value={members.filter((member) =>
                    (agents[line.id] ?? []).includes(member.membershipId),
                  )}
                  getOptionLabel={(member) => member.name}
                  isOptionEqualToValue={(option, value) =>
                    option.membershipId === value.membershipId
                  }
                  onChange={(_, values) =>
                    setAgents({ ...agents, [line.id]: values.map((value) => value.membershipId) })
                  }
                  disabled={busy}
                  renderInput={(props) => (
                    <TextField
                      {...props}
                      label={line.status === 'DISABLED' ? `${line.name} (desactivada)` : line.name}
                    />
                  )}
                />
              ))}
            </Stack>
          </Section>

          <Section title="Transferencia de chats">
            <FormControlLabel
              control={
                <Switch
                  checked={form.transfers}
                  onChange={(_, transfers) => setForm({ ...form, transfers })}
                />
              }
              label="Activar transferencia de chats"
            />
            <Typography variant="body2" color="text.secondary">
              Encendida, los agentes pasan sus chats a otros agentes. Apagada, solo transfieren los
              administradores.
            </Typography>
          </Section>

          <Section title="Firma de mensajes" description="El nombre del agente arriba del mensaje.">
            <RadioGroup
              value={form.signature}
              onChange={(_, signature) =>
                setForm({ ...form, signature: signature as SignatureMode })
              }
            >
              <Choice value="AGENT_CHOICE" label="Permitir que el agente elija" />
              <Choice value="NEVER" label="No firmar ninguno de los mensajes enviados" />
              <Choice value="ALWAYS" label="Siempre firmar todos los mensajes enviados" />
            </RadioGroup>
          </Section>

          <Section title="Enviar mensaje al cerrar conversaciones">
            <RadioGroup
              value={form.closeMessage.mode}
              onChange={(_, mode) =>
                setForm({
                  ...form,
                  closeMessage: { ...form.closeMessage, mode: mode as CloseMessageMode },
                })
              }
            >
              <Choice value="NEVER" label="No enviar" />
              <Choice value="ALWAYS" label="Enviar siempre" />
              <Choice
                value="ASK"
                label="Preguntar para enviar"
                help="Al cerrar, el agente elige si lo envía."
              />
            </RadioGroup>
            {form.closeMessage.mode !== 'NEVER' && (
              <TextField
                label="Mensaje al cerrar"
                multiline
                minRows={2}
                fullWidth
                sx={{ mt: 1 }}
                value={form.closeMessage.text}
                onChange={(event) =>
                  setForm({
                    ...form,
                    closeMessage: { ...form.closeMessage, text: event.target.value },
                  })
                }
                error={closeTextMissing}
                helperText={
                  closeTextMissing
                    ? 'Escribe el mensaje que se envía al cerrar.'
                    : 'Solo se envía dentro de las 24 horas del último mensaje del cliente.'
                }
                slotProps={{ htmlInput: { maxLength: 1024 } }}
              />
            )}
          </Section>

          <Section title="Avisos de mensajes nuevos">
            <AlertPreferences />
          </Section>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={busy || closeTextMissing}
        >
          Guardar
        </Button>
      </DialogActions>
    </>
  )
}
