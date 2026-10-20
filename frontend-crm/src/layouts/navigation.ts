import BadgeOutlined from '@mui/icons-material/BadgeOutlined'
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import HomeOutlined from '@mui/icons-material/HomeOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined'
import type { PermissionRule } from '../auth/usePermissions'
import { es } from '../i18n/es'

type Icon = typeof HomeOutlined

export interface NavLinkItem extends PermissionRule {
  kind: 'link'
  to: string
  label: string
  icon: Icon
  /** Only active on the exact path (the home page). */
  end?: boolean
}

export interface NavGroup {
  kind: 'group'
  id: string
  label: string
  icon: Icon
  children: NavLinkItem[]
}

export type NavEntry = NavLinkItem | NavGroup

const link = (item: Omit<NavLinkItem, 'kind'>): NavLinkItem => ({ kind: 'link', ...item })

/**
 * The side menu. Each link declares the permissions it needs (the same rule
 * guards its route in router.tsx), and a group only shows when at least one
 * of its links is visible.
 */
export const NAVIGATION: NavEntry[] = [
  link({ to: '/', label: es.app.nav.home, icon: HomeOutlined, end: true }),
  {
    kind: 'group',
    id: 'team',
    label: es.app.nav.team,
    icon: GroupsOutlined,
    children: [
      link({
        to: '/team/agents',
        label: es.app.nav.agents,
        icon: SupportAgentOutlined,
        anyOf: ['members.read'],
      }),
      link({
        to: '/team/roles',
        label: es.app.nav.roles,
        icon: BadgeOutlined,
        anyOf: ['roles.read'],
      }),
    ],
  },
  link({
    to: '/billing',
    label: es.app.nav.billing,
    icon: CreditCardOutlined,
    anyOf: ['billing.read'],
  }),
  link({ to: '/account/profile', label: es.app.nav.profile, icon: PersonOutlined }),
  link({ to: '/account/security', label: es.app.nav.security, icon: LockOutlined }),
]

/** Links of a group that the user may open, in menu order. */
export function visibleLinks(
  group: NavGroup,
  allows: (rule: PermissionRule) => boolean,
): NavLinkItem[] {
  return group.children.filter((item) => allows(item))
}
