import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { SplashScreen } from '../components/SplashScreen'
import { safeRedirect } from '../lib/redirect'
import { useAuth } from './auth-context'
import { usePermissions } from './usePermissions'
import { useMe } from './useMe'

/** Only lets signed-in users through; others go to /login?redirect=… */
export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SplashScreen />
  if (status === 'anonymous') {
    const redirect = `${location.pathname}${location.search}`
    const target = redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`
    return <Navigate to={target} replace />
  }
  return <Outlet />
}

/**
 * Inside the app: a user who still has the temporary password from their
 * admin must choose their own first (the API blocks everything else anyway).
 */
export function RequirePasswordChanged() {
  const { data: me, isPending } = useMe()
  if (isPending) return <SplashScreen />
  if (me?.mustChangePassword) return <Navigate to="/account/password-required" replace />
  return <Outlet />
}

/** `/team` opens the first Team page the user may see (agents, then roles). */
export function TeamIndex() {
  const { allows } = usePermissions()
  if (allows({ anyOf: ['members.read'] })) return <Navigate to="/team/agents" replace />
  if (allows({ anyOf: ['roles.read'] })) return <Navigate to="/team/roles" replace />
  return <Navigate to="/forbidden" replace />
}

/** Login/sign-up screens: a signed-in user is sent back into the app. */
export function PublicOnlyRoute() {
  const { status } = useAuth()
  const [params] = useSearchParams()

  if (status === 'loading') return <SplashScreen />
  if (status === 'authenticated')
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />
  return <Outlet />
}
