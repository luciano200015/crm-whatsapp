import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Can } from '../auth/permissions'
import { UnreadBadge } from '../components/inbox/InboxRealtime'
import { usePermissions } from '../auth/usePermissions'
import { NAVIGATION, visibleLinks, type NavGroup, type NavLinkItem } from './navigation'

const itemSx = {
  borderRadius: 2,
  mb: 0.5,
  '&.active': {
    bgcolor: 'action.selected',
    color: 'primary.main',
    '& .MuiListItemIcon-root': { color: 'primary.main' },
  },
} as const

/**
 * Side menu built from NAVIGATION: links without permission are not
 * rendered, and neither are groups left without visible links. Rendered
 * inside ActiveWorkspaceProvider, so switching workspace updates it.
 */
export function SideNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <List component="nav" aria-label="menu" sx={{ px: 1.5, pt: 1.5 }}>
      {NAVIGATION.map((entry) =>
        entry.kind === 'link' ? (
          <Can key={entry.to} anyOf={entry.anyOf} allOf={entry.allOf}>
            <NavItem item={entry} onNavigate={onNavigate} />
          </Can>
        ) : (
          <NavGroupItem key={entry.id} group={entry} onNavigate={onNavigate} />
        ),
      )}
    </List>
  )
}

function NavItem({
  item,
  nested,
  onNavigate,
}: {
  item: NavLinkItem
  nested?: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  return (
    <ListItemButton
      component={NavLink}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      sx={{ ...itemSx, pl: nested ? 4 : 2 }}
    >
      <ListItemIcon sx={{ minWidth: 38 }}>
        <Icon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={item.label} />
      {item.to === '/inbox' && <UnreadBadge />}
    </ListItemButton>
  )
}

function NavGroupItem({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const { allows } = usePermissions()
  const { pathname } = useLocation()
  const links = visibleLinks(group, allows)
  const containsCurrent = links.some((item) => pathname.startsWith(item.to))
  const [open, setOpen] = useState(containsCurrent)

  if (links.length === 0) return null
  const expanded = open || containsCurrent
  const Icon = group.icon
  const listId = `nav-group-${group.id}`

  return (
    <>
      <ListItemButton
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        aria-controls={listId}
        sx={{ borderRadius: 2, mb: 0.5 }}
      >
        <ListItemIcon sx={{ minWidth: 38 }}>
          <Icon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={group.label} />
        {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List id={listId} disablePadding>
          {links.map((item) => (
            <NavItem key={item.to} item={item} nested onNavigate={onNavigate} />
          ))}
        </List>
      </Collapse>
    </>
  )
}
