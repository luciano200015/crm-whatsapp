import BusinessOutlined from '@mui/icons-material/BusinessOutlined'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { es } from '../i18n/es'
import { roleName } from '../lib/team'
import { useActiveWorkspace } from './active-workspace-context'

export function WorkspaceSwitcher() {
  const { workspaces, active, select } = useActiveWorkspace()

  if (!active) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {es.app.noWorkspaces}
      </Typography>
    )
  }

  return (
    <Select
      size="small"
      value={active.id}
      onChange={(event) => select(event.target.value)}
      inputProps={{ 'aria-label': es.app.workspace }}
      sx={{ minWidth: { xs: 160, sm: 240 } }}
      renderValue={() => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BusinessOutlined fontSize="small" color="primary" />
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {active.name}
          </Typography>
        </Stack>
      )}
    >
      {workspaces.map((workspace) => (
        <MenuItem key={workspace.id} value={workspace.id}>
          <Stack>
            <Typography>{workspace.name}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {workspace.slug} · {workspace.roles.map(roleName).join(', ')}
            </Typography>
          </Stack>
        </MenuItem>
      ))}
    </Select>
  )
}
