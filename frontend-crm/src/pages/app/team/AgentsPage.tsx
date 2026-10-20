import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined'
import MoreVert from '@mui/icons-material/MoreVert'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useDeferredValue, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import {
  ChangeRoleDialog,
  NewMemberDialog,
  type NewMemberValues,
} from '../../../components/team/MemberDialogs'
import { useRoles, useTeamAccess } from '../../../components/team/useTeam'
import { Can } from '../../../auth/permissions'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'
import { errorMessage } from '../../../lib/api/errors'
import { teamApi, teamKeys } from '../../../lib/api/team'
import type { Member, MembershipStatus } from '../../../lib/api/types'
import { formatDate } from '../../../lib/billing'
import { holdsAll, initials, roleName } from '../../../lib/team'
import { meQueryKey } from '../../../lib/api/users'

type StatusFilter = 'ALL' | MembershipStatus

/** Equipo → Agentes. The route requires members.read. */
export function AgentsPage() {
  useDocumentTitle(es.team.agentsTitle)
  const team = useTeamAccess()
  const workspaceId = team.workspaceId ?? ''
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const filter = {
    search: useDeferredValue(search.trim()) || undefined,
    status: status === 'ALL' ? undefined : status,
  }
  const members = useQuery({
    queryKey: teamKeys.members(workspaceId, filter),
    queryFn: () => teamApi.members(workspaceId, filter),
    enabled: workspaceId !== '',
    placeholderData: keepPreviousData,
  })
  const roles = useRoles(team.workspaceId)

  const [creating, setCreating] = useState(false)
  const [changingRole, setChangingRole] = useState<Member | null>(null)
  const [deactivating, setDeactivating] = useState<Member | null>(null)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: teamKeys.all(workspaceId) })
    // The plan banner and usage figures come from /users/me too.
    await queryClient.invalidateQueries({ queryKey: meQueryKey })
  }
  const onError = (error: unknown) => enqueueSnackbar(errorMessage(error), { variant: 'error' })

  const statusChange = useMutation({
    mutationFn: ({ member, active }: { member: Member; active: boolean }) =>
      active
        ? teamApi.reactivate(workspaceId, member.id)
        : teamApi.deactivate(workspaceId, member.id),
    onSuccess: async (_member, { active }) => {
      setDeactivating(null)
      await refresh()
      enqueueSnackbar(active ? es.team.reactivated : es.team.deactivated, {
        variant: 'success',
      })
    },
    onError,
  })
  const resend = useMutation({
    mutationFn: (member: Member) => teamApi.resendAccess(workspaceId, member.id),
    onSuccess: () => enqueueSnackbar(es.team.accessResent, { variant: 'success' }),
    onError,
  })

  const usage = members.data?.usage
  const limitReached = usage ? usage.limit !== null && usage.activeMembers >= usage.limit : false
  // Only roles the API will let this user assign (custom ones need the plan feature).
  const assignableRoles = (roles.data ?? []).filter(
    (role) =>
      holdsAll(team.permissions, role.permissions) && (role.system || team.customRolesIncluded),
  )
  const blockedReason = !team.planActive
    ? es.team.planInactive
    : limitReached
      ? es.team.limitReached(team.planName)
      : null

  /** Same rules as the API: never yourself, only members whose permissions you hold. */
  const manageable = (member: Member) =>
    member.userId !== team.userId && holdsAll(team.permissions, member.permissions)

  const createMember = async (values: NewMemberValues) => {
    const created = await teamApi.createMember(workspaceId, values)
    await refresh()
    enqueueSnackbar(es.team.created(created.email), { variant: 'success' })
  }

  const changeRole = async (member: Member, roleId: string) => {
    await teamApi.changeRole(workspaceId, member.id, roleId)
    await refresh()
    enqueueSnackbar(es.team.roleChanged, { variant: 'success' })
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader title={es.team.agentsTitle} subtitle={es.team.agentsSubtitle} />
      {blockedReason && team.can('members.invite') && (
        <Alert
          severity="warning"
          action={
            team.can('billing.read') && (
              <Button component={RouterLink} to="/billing" color="inherit" size="small">
                {es.team.upgrade}
              </Button>
            )
          }
        >
          {blockedReason}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' } }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={es.team.search}
          slotProps={{
            htmlInput: { 'aria-label': es.team.search },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flexGrow: 1, maxWidth: { md: 360 } }}
        />
        <TextField
          select
          size="small"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          slotProps={{ htmlInput: { 'aria-label': es.team.statusFilter } }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="ALL">{es.team.all}</MenuItem>
          <MenuItem value="ACTIVE">{es.team.status.ACTIVE}</MenuItem>
          <MenuItem value="DEACTIVATED">{es.team.status.DEACTIVATED}</MenuItem>
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        {usage && (
          <Chip
            variant="outlined"
            color={limitReached ? 'warning' : 'default'}
            label={es.team.usage(usage.activeMembers, usage.limit)}
          />
        )}
        <Can anyOf={['members.invite']}>
          <Tooltip title={blockedReason ?? ''}>
            <span>
              <Button
                variant="contained"
                startIcon={<PersonAddAlt1Outlined />}
                disabled={Boolean(blockedReason) || assignableRoles.length === 0}
                onClick={() => setCreating(true)}
                fullWidth
              >
                {es.team.newMember}
              </Button>
            </span>
          </Tooltip>
        </Can>
      </Stack>

      <Card variant="outlined">
        {members.isFetching && <LinearProgress sx={{ height: 2 }} />}
        <TableContainer>
          <Table size="medium" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>{es.team.columns.member}</TableCell>
                <TableCell>{es.team.columns.role}</TableCell>
                <TableCell>{es.team.columns.status}</TableCell>
                <TableCell>{es.team.columns.lastLogin}</TableCell>
                <TableCell align="right">{es.team.columns.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.isPending ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton variant="rounded" height={120} />
                  </TableCell>
                </TableRow>
              ) : members.isError ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Alert severity="error">{errorMessage(members.error)}</Alert>
                  </TableCell>
                </TableRow>
              ) : members.data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}
                  >
                    {es.team.empty}
                  </TableCell>
                </TableRow>
              ) : (
                members.data.items.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={member.userId === team.userId}
                    canManage={team.can('members.manage') && manageable(member)}
                    canResend={team.can('members.invite') && manageable(member)}
                    canReactivate={!blockedReason}
                    onChangeRole={() => setChangingRole(member)}
                    onDeactivate={() => setDeactivating(member)}
                    onReactivate={() => statusChange.mutate({ member, active: true })}
                    onResend={() => resend.mutate(member)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {creating && (
        <NewMemberDialog
          open
          roles={assignableRoles}
          onClose={() => setCreating(false)}
          onSubmit={createMember}
        />
      )}
      {changingRole && (
        <ChangeRoleDialog
          memberName={changingRole.displayName}
          currentRoleId={changingRole.role?.id ?? ''}
          roles={assignableRoles}
          onClose={() => setChangingRole(null)}
          onSubmit={(roleId) => changeRole(changingRole, roleId)}
        />
      )}
      <ConfirmDialog
        open={deactivating !== null}
        title={es.team.deactivateTitle}
        confirmLabel={es.team.deactivate}
        danger
        loading={statusChange.isPending}
        onClose={() => setDeactivating(null)}
        onConfirm={() =>
          deactivating && statusChange.mutate({ member: deactivating, active: false })
        }
      >
        {deactivating && es.team.confirmDeactivate(deactivating.displayName)}
      </ConfirmDialog>
    </Stack>
  )
}

function MemberRow({
  member,
  isSelf,
  canManage,
  canResend,
  canReactivate,
  onChangeRole,
  onDeactivate,
  onReactivate,
  onResend,
}: {
  member: Member
  isSelf: boolean
  canManage: boolean
  canResend: boolean
  canReactivate: boolean
  onChangeRole: () => void
  onDeactivate: () => void
  onReactivate: () => void
  onResend: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const active = member.status === 'ACTIVE'
  const run = (action: () => void) => () => {
    setAnchor(null)
    action()
  }

  const actions = [
    canManage && active && { label: es.team.changeRole, onClick: onChangeRole },
    canResend &&
      active &&
      member.pendingFirstAccess && { label: es.team.resendAccess, onClick: onResend },
    canManage && active && { label: es.team.deactivate, onClick: onDeactivate, danger: true },
    canManage && !active && canReactivate && { label: es.team.reactivate, onClick: onReactivate },
  ].filter(Boolean) as { label: string; onClick: () => void; danger?: boolean }[]

  return (
    <TableRow hover sx={{ opacity: active ? 1 : 0.6 }}>
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Avatar
            src={member.avatarUrl ?? undefined}
            alt=""
            sx={(theme) => ({
              width: 36,
              height: 36,
              fontSize: 14,
              background: theme.custom.gradient,
            })}
          >
            {initials(member.displayName)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {member.displayName}
              {isSelf && <Chip label={es.team.you} size="small" sx={{ ml: 1, height: 20 }} />}
            </Typography>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {member.email}
            </Typography>
          </Box>
        </Stack>
      </TableCell>
      <TableCell>
        {member.role && (
          <Chip
            size="small"
            color={member.role.system ? 'primary' : 'secondary'}
            variant="outlined"
            label={roleName(member.role)}
          />
        )}
      </TableCell>
      <TableCell>
        {active && member.pendingFirstAccess ? (
          <Chip size="small" color="warning" variant="outlined" label={es.team.status.pending} />
        ) : (
          <Chip
            size="small"
            color={active ? 'success' : 'default'}
            variant={active ? 'outlined' : 'filled'}
            label={es.team.status[member.status]}
          />
        )}
      </TableCell>
      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {member.lastLoginAt ? formatDate(member.lastLoginAt) : es.team.never}
      </TableCell>
      <TableCell align="right">
        {actions.length > 0 && (
          <>
            <IconButton
              aria-label={es.team.actionsFor(member.displayName)}
              onClick={(event) => setAnchor(event.currentTarget)}
            >
              <MoreVert />
            </IconButton>
            <Menu
              anchorEl={anchor}
              open={Boolean(anchor)}
              onClose={() => setAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {actions.map((action) => (
                <MenuItem
                  key={action.label}
                  onClick={run(action.onClick)}
                  sx={action.danger ? { color: 'error.main' } : undefined}
                >
                  {action.label}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}
