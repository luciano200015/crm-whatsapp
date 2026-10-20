import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { usePermissions, type PermissionRule } from './usePermissions'

/** Renders its children only when the rule is met; otherwise renders nothing. */
export function Can({
  children,
  fallback = null,
  ...rule
}: PermissionRule & { children: ReactNode; fallback?: ReactNode }) {
  const { allows } = usePermissions()
  return <>{allows(rule) ? children : fallback}</>
}

/**
 * Route element for pages that need permissions: without them the user is
 * sent to /forbidden (the page they tried is kept in the location state).
 */
export function RequirePermission(rule: PermissionRule) {
  const { allows } = usePermissions()
  const location = useLocation()
  if (!allows(rule)) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
