import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { Link as RouterLink, Navigate, Outlet, useLocation } from 'react-router'
import { PageHeader } from '../../../components/PageHeader'
import { useTeamAccess } from '../../../components/team/useTeam'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { es } from '../../../i18n/es'

/** Team section: Agents and Roles tabs, like the reference product. */
export function TeamPage() {
  useDocumentTitle(es.team.title)
  const { pathname } = useLocation()
  const { workspaceId, can } = useTeamAccess()

  if (!workspaceId) return <Alert severity="info">{es.dashboard.noWorkspace}</Alert>

  const tabs = [
    { to: '/team/members', label: es.team.tabs.members, visible: can('members.read') },
    { to: '/team/roles', label: es.team.tabs.roles, visible: can('roles.read') },
  ].filter((tab) => tab.visible)
  const current = tabs.find((tab) => pathname.startsWith(tab.to))
  // E.g. a member who can see roles but not the member list.
  const fallback = tabs[0]
  if (!current && fallback) return <Navigate to={fallback.to} replace />

  return (
    <>
      <PageHeader title={es.team.title} subtitle={es.team.subtitle} />
      {tabs.length === 0 || !current ? (
        <Alert severity="info">{es.team.noPermission}</Alert>
      ) : (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={current.to} aria-label={es.team.title}>
              {tabs.map((tab) => (
                <Tab
                  key={tab.to}
                  value={tab.to}
                  label={tab.label}
                  component={RouterLink}
                  to={tab.to}
                  sx={{ fontWeight: 600 }}
                />
              ))}
            </Tabs>
          </Box>
          <Outlet />
        </>
      )}
    </>
  )
}
