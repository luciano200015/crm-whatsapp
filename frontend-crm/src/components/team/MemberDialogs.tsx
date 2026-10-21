import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormLabel from '@mui/material/FormLabel'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Line, Role } from '../../lib/api/types'
import { roleDescription, roleName } from '../../lib/team'
import { emailSchema } from '../../lib/validation'
import { FormTextField } from '../form/FormTextField'

const newMemberSchema = z.object({
  displayName: z.string().trim().min(1, es.common.required).max(120, es.validation.maxLength(120)),
  email: emailSchema,
  roleId: z.string().min(1, es.common.required),
  lineIds: z.array(z.string()),
})
export type NewMemberValues = z.infer<typeof newMemberSchema>

const roleSchema = z.object({ roleId: z.string().min(1, es.common.required) })
type RoleValues = z.infer<typeof roleSchema>

/** Register an agent: name, email, role and lines. The API emails a temporary password. */
export function NewMemberDialog({
  open,
  roles,
  lines,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** Roles the current user may assign. */
  roles: Role[]
  /** Lines to choose from; omitted without channels.manage. */
  lines?: Line[]
  onClose: () => void
  onSubmit: (values: NewMemberValues) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState, reset } = useForm<NewMemberValues>({
    resolver: zodResolver(newMemberSchema),
    defaultValues: {
      displayName: '',
      email: '',
      roleId: roles.find((r) => r.key === 'AGENT')?.id ?? '',
      lineIds: [],
    },
  })

  const close = () => {
    reset()
    setError(null)
    onClose()
  }

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      await onSubmit(values)
      close()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog
      open={open}
      onClose={formState.isSubmitting ? undefined : close}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{es.team.form.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {es.team.form.intro}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <FormTextField
              control={control}
              name="displayName"
              label={es.team.form.name}
              placeholder={es.team.form.namePlaceholder}
              autoComplete="off"
              autoFocus
              required
              fullWidth
            />
            <FormTextField
              control={control}
              name="email"
              type="email"
              label={es.team.form.email}
              placeholder={es.team.form.emailPlaceholder}
              autoComplete="off"
              helperText={es.team.form.existingNote}
              required
              fullWidth
            />
            <Controller
              name="roleId"
              control={control}
              render={({ field, fieldState }) => (
                <RoleSelect
                  roles={roles}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            {lines && lines.length > 0 && (
              <Controller
                name="lineIds"
                control={control}
                render={({ field }) => (
                  <Box>
                    <FormLabel
                      component="div"
                      sx={{ mb: 0.25, fontSize: 13, fontWeight: 600, color: 'text.secondary' }}
                    >
                      {es.team.form.lines}
                    </FormLabel>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {es.team.form.linesHelp}
                    </Typography>
                    <LineChecklist lines={lines} value={field.value} onChange={field.onChange} />
                  </Box>
                )}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {es.team.form.submit}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

/** Change the role of one member. */
export function ChangeRoleDialog({
  memberName,
  currentRoleId,
  roles,
  onClose,
  onSubmit,
}: {
  memberName: string
  currentRoleId: string
  roles: Role[]
  onClose: () => void
  onSubmit: (roleId: string) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { roleId: currentRoleId },
  })

  const submit = handleSubmit(async ({ roleId }) => {
    setError(null)
    try {
      await onSubmit(roleId)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="xs">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {es.team.form.changeRoleTitle(memberName)}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Controller
              name="roleId"
              control={control}
              render={({ field, fieldState }) => (
                <RoleSelect
                  roles={roles}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {es.common.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

/** The WhatsApp lines a member attends: only their chats reach them. */
export function MemberLinesDialog({
  memberName,
  viewAll,
  lines,
  current,
  onClose,
  onSubmit,
}: {
  memberName: string
  /** Their role sees every line anyway. */
  viewAll: boolean
  lines: Line[]
  current: string[]
  onClose: () => void
  onSubmit: (lineIds: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSubmit(selected)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{es.team.linesDialog.title(memberName)}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {es.team.linesDialog.help}
          </Typography>
          {viewAll && <Alert severity="info">{es.team.linesDialog.viewAllNote}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {lines.length === 0 ? (
            <Alert severity="warning">{es.team.linesDialog.empty}</Alert>
          ) : (
            <LineChecklist lines={lines} value={selected} onChange={setSelected} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || lines.length === 0}
        >
          {es.team.linesDialog.save}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function LineChecklist({
  lines,
  value,
  onChange,
}: {
  lines: Line[]
  value: string[]
  onChange: (lineIds: string[]) => void
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <List dense disablePadding>
      {lines.map((line) => (
        <ListItemButton key={line.id} onClick={() => toggle(line.id)} sx={{ borderRadius: 1 }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <Checkbox
              edge="start"
              checked={value.includes(line.id)}
              tabIndex={-1}
              disableRipple
              slotProps={{ input: { 'aria-label': line.name } }}
            />
          </ListItemIcon>
          <ListItemText primary={line.name} secondary={line.displayPhone ?? line.phoneNumberId} />
          {line.status !== 'CONNECTED' && (
            <Chip
              size="small"
              variant="outlined"
              color={line.status === 'ERROR' ? 'error' : 'default'}
              label={es.lines.status[line.status]}
            />
          )}
        </ListItemButton>
      ))}
    </List>
  )
}

function RoleSelect({
  roles,
  value,
  onChange,
  error,
}: {
  roles: Role[]
  value: string
  onChange: (roleId: string) => void
  error?: string
}) {
  const id = useId()
  return (
    <Box>
      <FormLabel
        htmlFor={id}
        required
        sx={{
          display: 'block',
          mb: 0.75,
          fontSize: 13,
          fontWeight: 600,
          color: 'text.secondary',
          '& .MuiFormLabel-asterisk': { color: 'error.main' },
        }}
      >
        {es.team.form.role}
      </FormLabel>
      <TextField
        id={id}
        select
        fullWidth
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={Boolean(error)}
        helperText={error}
      >
        {roles.map((role) => (
          <MenuItem key={role.id} value={role.id}>
            <Stack>
              <Typography>{roleName(role)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {roleDescription(role)}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
}
