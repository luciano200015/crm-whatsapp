import { zodResolver } from '@hookform/resolvers/zod'
import LockOutlined from '@mui/icons-material/LockOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText from '@mui/material/FormHelperText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { PermissionInfo, Role, RoleRequest } from '../../lib/api/types'
import {
  groupLabel,
  PERMISSION_GROUP_ORDER,
  permissionLabel,
  roleDescription,
  roleName,
} from '../../lib/team'
import { FormTextField } from '../form/FormTextField'

const roleFormSchema = z.object({
  name: z.string().trim().min(2, es.common.required).max(60, es.validation.maxLength(60)),
  description: z.string().trim().max(300, es.validation.maxLength(300)),
  permissions: z.array(z.string()).min(1, es.team.roleForm.atLeastOne),
})
type RoleFormValues = z.infer<typeof roleFormSchema>

export type RoleDialogMode = { kind: 'create' } | { kind: 'edit' | 'view'; role: Role }

/**
 * Create or edit a custom role from the permission catalog, grouped by
 * module. In view mode (system roles, or no roles.manage) it is read-only.
 */
export function RoleDialog({
  mode,
  catalog,
  held,
  onClose,
  onSubmit,
}: {
  mode: RoleDialogMode
  catalog: PermissionInfo[]
  /** Permissions of the current user: only these can be granted. */
  held: ReadonlySet<string>
  onClose: () => void
  onSubmit: (values: RoleRequest) => Promise<void>
}) {
  const readOnly = mode.kind === 'view'
  const role = mode.kind === 'create' ? null : mode.role
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: {
      name: role && !role.system ? role.name : '',
      description: role && !role.system ? (role.description ?? '') : '',
      permissions: role?.permissions ?? [],
    },
  })

  const groups = PERMISSION_GROUP_ORDER.map((group) => ({
    group,
    permissions: catalog.filter((p) => p.group === group),
  })).filter((g) => g.permissions.length > 0)

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      await onSubmit({
        name: values.name,
        description: values.description || null,
        permissions: values.permissions,
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  const title =
    mode.kind === 'create'
      ? es.team.roleForm.createTitle
      : mode.kind === 'edit'
        ? es.team.roleForm.editTitle
        : `${es.team.roleForm.viewTitle}: ${roleName(mode.role)}`

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="md">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {readOnly && role ? (
              <Stack spacing={1}>
                <Typography sx={{ color: 'text.secondary' }}>{roleDescription(role)}</Typography>
                {role.system && (
                  <Alert severity="info" icon={<LockOutlined fontSize="small" />}>
                    {es.team.systemHelp}
                  </Alert>
                )}
              </Stack>
            ) : (
              <>
                <FormTextField
                  control={control}
                  name="name"
                  label={es.team.roleForm.name}
                  placeholder={es.team.roleForm.namePlaceholder}
                  autoFocus
                  required
                  fullWidth
                />
                <FormTextField
                  control={control}
                  name="description"
                  label={es.team.roleForm.description}
                  placeholder={es.team.roleForm.descriptionPlaceholder}
                  fullWidth
                />
              </>
            )}

            <Controller
              name="permissions"
              control={control}
              render={({ field, fieldState }) => {
                const selected = new Set(field.value)
                const toggle = (keys: string[], on: boolean) => {
                  const next = new Set(selected)
                  for (const key of keys) {
                    if (on) next.add(key)
                    else next.delete(key)
                  }
                  field.onChange([...next].sort())
                }
                return (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {es.team.roleForm.permissions}
                    </Typography>
                    {!readOnly && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {es.team.roleForm.permissionsHelp}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        mt: 1.5,
                        display: 'grid',
                        gap: 1.5,
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      }}
                    >
                      {groups.map(({ group, permissions }) => {
                        const grantable = permissions
                          .map((p) => p.key)
                          .filter((key) => held.has(key))
                        const checkedCount = permissions.filter((p) => selected.has(p.key)).length
                        return (
                          <Paper key={group} variant="outlined" sx={{ p: 1.5 }}>
                            <FormControlLabel
                              label={
                                <Typography sx={{ fontWeight: 600 }}>
                                  {groupLabel(group)}
                                </Typography>
                              }
                              control={
                                <Checkbox
                                  size="small"
                                  checked={checkedCount === permissions.length}
                                  indeterminate={
                                    checkedCount > 0 && checkedCount < permissions.length
                                  }
                                  disabled={readOnly || grantable.length === 0}
                                  onChange={(event) => toggle(grantable, event.target.checked)}
                                  slotProps={{
                                    input: {
                                      'aria-label': `${es.team.roleForm.selectAll}: ${groupLabel(group)}`,
                                    },
                                  }}
                                />
                              }
                            />
                            <Stack sx={{ pl: 3 }}>
                              {permissions.map((permission) => (
                                <FormControlLabel
                                  key={permission.key}
                                  label={
                                    <Typography variant="body2">
                                      {permissionLabel(permission.key)}
                                    </Typography>
                                  }
                                  control={
                                    <Checkbox
                                      size="small"
                                      checked={selected.has(permission.key)}
                                      disabled={readOnly || !held.has(permission.key)}
                                      onChange={(event) =>
                                        toggle([permission.key], event.target.checked)
                                      }
                                    />
                                  }
                                />
                              ))}
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Box>
                    {fieldState.error && (
                      <FormHelperText error>{fieldState.error.message}</FormHelperText>
                    )}
                  </Box>
                )
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={formState.isSubmitting}>
            {readOnly ? es.team.roleForm.close : es.common.cancel}
          </Button>
          {!readOnly && (
            <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
              {es.team.roleForm.save}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  )
}
