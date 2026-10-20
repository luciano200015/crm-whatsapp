import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import HomeOutlined from '@mui/icons-material/HomeOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { useMe } from '../auth/useMe'
import { PlanBanner } from '../components/billing/PlanBanner'
import { Logo } from '../components/Logo'
import { es } from '../i18n/es'
import { ColorModeToggle } from '../theme/ColorModeToggle'
import { themeConfig } from '../theme/theme.config'
import { ActiveWorkspaceProvider } from '../workspace/active-workspace'
import { useActiveWorkspace } from '../workspace/active-workspace-context'
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher'

const DRAWER_WIDTH = 248

/** `anyOf`: shown only with one of these permissions in the active workspace. */
const NAV: {
  to: string
  label: string
  icon: typeof HomeOutlined
  end: boolean
  anyOf?: string[]
}[] = [
  { to: '/', label: es.app.nav.home, icon: HomeOutlined, end: true },
  {
    to: '/team',
    label: es.app.nav.team,
    icon: GroupsOutlined,
    end: false,
    anyOf: ['members.read', 'roles.read'],
  },
  { to: '/billing', label: es.app.nav.billing, icon: CreditCardOutlined, end: false },
  { to: '/account/profile', label: es.app.nav.profile, icon: PersonOutlined, end: false },
  { to: '/account/security', label: es.app.nav.security, icon: LockOutlined, end: false },
]

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  const navigation = (
    <Box sx={{ py: 2 }}>
      <Box sx={{ px: 2.5, pb: 2 }}>
        <Logo height={32} />
      </Box>
      <Divider />
      <NavList onNavigate={() => setMobileOpen(false)} />
    </Box>
  )

  return (
    <ActiveWorkspaceProvider>
      <Box sx={{ display: 'flex', minHeight: '100svh', bgcolor: 'background.default' }}>
        <AppBar
          position="fixed"
          color="inherit"
          elevation={0}
          sx={{
            width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
            ml: { md: `${DRAWER_WIDTH}px` },
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Toolbar sx={{ gap: 1.5 }}>
            <IconButton
              aria-label={es.app.openNav}
              onClick={() => setMobileOpen(true)}
              sx={{ display: { md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <WorkspaceSwitcher />
            <Box sx={{ flexGrow: 1 }} />
            <ColorModeToggle />
            <UserMenu />
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            sx={{
              display: { xs: 'block', md: 'none' },
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
            }}
          >
            {navigation}
          </Drawer>
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: 'none', md: 'block' },
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
            }}
          >
            {navigation}
          </Drawer>
        </Box>

        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, sm: 4 }, mt: 8 }}>
          <PlanBanner />
          <Outlet />
        </Box>
      </Box>
    </ActiveWorkspaceProvider>
  )
}

/** Rendered inside ActiveWorkspaceProvider: items depend on the active workspace's permissions. */
function NavList({ onNavigate }: { onNavigate: () => void }) {
  const { active } = useActiveWorkspace()
  const permissions = new Set(active?.permissions ?? [])
  const items = NAV.filter((item) => !item.anyOf || item.anyOf.some((p) => permissions.has(p)))

  return (
    <List sx={{ px: 1.5, pt: 1.5 }}>
      {items.map(({ to, label, icon: Icon, end }) => (
        <ListItemButton
          key={to}
          component={NavLink}
          to={to}
          end={end}
          onClick={onNavigate}
          sx={{
            borderRadius: 2,
            mb: 0.5,
            '&.active': {
              bgcolor: 'action.selected',
              color: 'primary.main',
              '& .MuiListItemIcon-root': { color: 'primary.main' },
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 38 }}>
            <Icon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={label} />
        </ListItemButton>
      ))}
    </List>
  )
}

function UserMenu() {
  const { data: me } = useMe()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const go = (path: string) => {
    setAnchor(null)
    void navigate(path)
  }

  const signOut = async () => {
    setAnchor(null)
    await logout()
    enqueueSnackbar(es.app.logoutDone, { variant: 'info' })
    void navigate('/login', { replace: true })
  }

  const name = me?.displayName ?? ''
  return (
    <>
      <IconButton aria-label={es.app.userMenu} onClick={(e) => setAnchor(e.currentTarget)}>
        <Avatar
          src={me?.avatarUrl ?? undefined}
          alt={name}
          sx={(theme) => ({
            width: 34,
            height: 34,
            background: theme.custom.gradient,
            fontSize: 15,
          })}
        >
          {initials(name)}
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240, mt: 1 } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ fontWeight: 600 }}>{name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {me?.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => go('/account/profile')}>
          <ListItemIcon>
            <PersonOutlined fontSize="small" />
          </ListItemIcon>
          {es.app.nav.profile}
        </MenuItem>
        <MenuItem onClick={() => go('/account/security')}>
          <ListItemIcon>
            <LockOutlined fontSize="small" />
          </ListItemIcon>
          {es.app.nav.security}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => void signOut()}>
          <ListItemIcon>
            <LogoutOutlined fontSize="small" />
          </ListItemIcon>
          {es.app.logout}
        </MenuItem>
      </Menu>
    </>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : [parts[0]]
  return (
    letters.map((part) => part?.[0]?.toUpperCase() ?? '').join('') ||
    themeConfig.brand.name[0] ||
    '?'
  )
}
