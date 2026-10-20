import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Line, LineChanges, Member } from '../../lib/api/types'
import { FormTextField } from '../form/FormTextField'
import { PasswordField } from '../form/PasswordField'

const metaId = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, es.lines.form.numericId)

function lineSchema(editing: boolean) {
  // When editing, empty secrets keep the stored ones.
  const secret = (min: number) =>
    editing
      ? z.union([z.literal(''), z.string().trim().min(min)])
      : z.string().trim().min(min, es.common.required)
  return z.object({
    name: z.string().trim().min(1, es.common.required).max(80, es.validation.maxLength(80)),
    phoneNumberId: metaId,
    wabaId: z.union([z.literal(''), metaId]),
    displayPhone: z.string().trim().max(32, es.validation.maxLength(32)),
    accessToken: secret(20),
    appSecret: secret(16),
  })
}
type LineValues = z.infer<ReturnType<typeof lineSchema>>

/** Create a line, or edit it (secrets are only sent when replaced). */
export function LineDialog({
  line,
  onClose,
  onSubmit,
}: {
  line: Line | null
  onClose: () => void
  onSubmit: (values: LineChanges) => Promise<void>
}) {
  const editing = line !== null
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<LineValues>({
    resolver: zodResolver(lineSchema(editing)),
    defaultValues: {
      name: line?.name ?? '',
      phoneNumberId: line?.phoneNumberId ?? '',
      wabaId: line?.wabaId ?? '',
      displayPhone: line?.displayPhone ?? '',
      accessToken: '',
      appSecret: '',
    },
  })

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      await onSubmit({
        name: values.name,
        phoneNumberId: values.phoneNumberId,
        wabaId: values.wabaId || null,
        displayPhone: values.displayPhone || null,
        ...(values.accessToken && { accessToken: values.accessToken }),
        ...(values.appSecret && { appSecret: values.appSecret }),
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit} autoComplete="off">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editing ? es.lines.form.editTitle : es.lines.form.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {es.lines.form.intro}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <FormTextField
              control={control}
              name="name"
              label={es.lines.form.name}
              placeholder={es.lines.form.namePlaceholder}
              autoFocus
              required
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormTextField
                control={control}
                name="phoneNumberId"
                label={es.lines.form.phoneNumberId}
                placeholder={es.lines.form.phoneNumberIdPlaceholder}
                required
                fullWidth
              />
              <FormTextField
                control={control}
                name="displayPhone"
                label={es.lines.form.displayPhone}
                placeholder={es.lines.form.displayPhonePlaceholder}
                fullWidth
              />
            </Stack>
            <FormTextField control={control} name="wabaId" label={es.lines.form.wabaId} fullWidth />
            <PasswordField
              control={control}
              name="accessToken"
              label={es.lines.form.accessToken}
              helperText={editing ? es.lines.form.keepSecret : undefined}
              autoComplete="off"
              required={!editing}
              fullWidth
            />
            <PasswordField
              control={control}
              name="appSecret"
              label={es.lines.form.appSecret}
              helperText={editing ? es.lines.form.keepSecret : undefined}
              autoComplete="off"
              required={!editing}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {es.lines.form.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

/** Pick the agents (active members) who attend a line. */
export function LineAgentsDialog({
  line,
  members,
  onClose,
  onSubmit,
}: {
  line: Line
  members: Member[]
  onClose: () => void
  onSubmit: (membershipIds: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState(
    () => new Set(line.agents.map((agent) => agent.membershipId)),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSubmit([...selected])
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{es.lines.agentsDialog.title(line.name)}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {es.lines.agentsDialog.help}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <List dense>
          {members.map((member) => {
            const checked = selected.has(member.id)
            return (
              <ListItemButton key={member.id} onClick={() => toggle(member.id)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Checkbox
                    edge="start"
                    checked={checked}
                    tabIndex={-1}
                    disableRipple
                    slotProps={{ input: { 'aria-label': member.displayName } }}
                  />
                </ListItemIcon>
                <ListItemText primary={member.displayName} secondary={member.email} />
              </ListItemButton>
            )
          })}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          {es.common.cancel}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving}>
          {es.lines.agentsDialog.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
