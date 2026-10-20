import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { RoleDialog, type RoleDialogMode } from '../../../components/team/RoleDialog'
import { usePermissionCatalog, useRoles, useTeamAccess } from '../../../components/team/useTeam'
import { es } from '../../../i18n/es'
import { errorMessage } from '../../../lib/api/errors'
import { teamApi, teamKeys } from '../../../lib/api/team'
import type { Role, RoleRequest } from '../../../lib/api/types'
import { meQueryKey } from '../../../lib/api/users'
import { holdsAll, roleDescription, roleName } from '../../../lib/team'

export function RolesPage() {
  const team = useTeamAccess()
  const workspaceId = team.workspaceId ?? ''
  const roles = useRoles(team.workspaceId)
  const catalog = usePermissionCatalog(team.workspaceId)
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()

  const [dialog, setDialog] = useState<RoleDialogMode | null>(null)
  const [deleting, setDeleting] = useState<Role | null>(null)

  const canManage = team.can('roles.manage')
  const canEditCustom = canManage && team.customRolesIncluded

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: teamKeys.all(workspaceId) })
    // Editing a role may change the current user's own permissions.
    await queryClient.invalidateQueries({ queryKey: meQueryKey })
  }

  const remove = useMutation({
    mutationFn: (role: Role) => teamApi.deleteRole(workspaceId, role.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
      enqueueSnackbar(es.team.roleDeleted, { variant: 'success' })
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  const save = async (values: RoleRequest) => {
    if (dialog?.kind === 'edit') {
      await teamApi.updateRole(workspaceId, dialog.role.id, values)
      enqueueSnackbar(es.team.roleUpdated, { variant: 'success' })
    } else {
      await teamApi.createRole(workspaceId, values)
      enqueueSnackbar(es.team.roleCreated, { variant: 'success' })
    }
    await refresh()
  }

  return (
    <Stack spacing={2.5}>
      {canManage && !team.customRolesIncluded && (
        <Alert
          severity="info"
          action={
            team.can('billing.read') && (
              <Button component={RouterLink} to="/billing" color="inherit" size="small">
                {es.team.upgrade}
              </Button>
            )
          }
        >
          {es.team.customRolesLocked(team.planName)}
        </Alert>
      )}

      {canManage && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            disabled={!team.customRolesIncluded || !catalog.data}
            onClick={() => setDialog({ kind: 'create' })}
          >
            {es.team.newRole}
          </Button>
        </Box>
      )}

      {roles.isPending ? (
        <Skeleton variant="rounded" height={180} />
      ) : roles.isError ? (
        <Alert severity="error">{errorMessage(roles.error)}</Alert>
      ) : (
        <Grid container spacing={2}>
          {roles.data.map((role) => {
            // Same rule as the API: you can only edit or delete what you could grant.
            const editable =
              !role.system && canManage && holdsAll(team.permissions, role.permissions)
            return (
              <Grid key={role.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card
                  variant="outlined"
                  sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>
                        {roleName(role)}
                      </Typography>
                      {role.system ? (
                        <Chip
                          size="small"
                          icon={<LockOutlined />}
                          label={es.team.systemRole}
                          variant="outlined"
                        />
                      ) : (
                        <Chip
                          size="small"
                          color="secondary"
                          variant="outlined"
                          label={es.team.customRole}
                        />
                      )}
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'text.secondary', minHeight: 40 }}>
                      {roleDescription(role)}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                      <Chip size="small" label={es.team.members(role.memberCount)} />
                      <Chip
                        size="small"
                        label={es.team.permissionsCount(role.permissions.length)}
                      />
                    </Stack>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    {editable && canEditCustom ? (
                      <Button
                        size="small"
                        startIcon={<EditOutlined />}
                        disabled={!catalog.data}
                        onClick={() => setDialog({ kind: 'edit', role })}
                      >
                        {es.team.edit}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        startIcon={<VisibilityOutlined />}
                        disabled={!catalog.data}
                        onClick={() => setDialog({ kind: 'view', role })}
                      >
                        {es.team.view}
                      </Button>
                    )}
                    {editable && (
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutline />}
                        onClick={() => setDeleting(role)}
                      >
                        {es.team.delete}
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            )
          })}
        </Grid>
      )}

      {dialog && catalog.data && (
        <RoleDialog
          mode={dialog}
          catalog={catalog.data}
          held={team.permissions}
          onClose={() => setDialog(null)}
          onSubmit={save}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={es.team.deleteTitle}
        confirmLabel={es.team.delete}
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {deleting && es.team.confirmDelete(deleting.name)}
      </ConfirmDialog>
    </Stack>
  )
}
