import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { SplashScreen } from '../components/SplashScreen'
import { safeRedirect } from '../lib/redirect'
import { useAuth } from './auth-context'

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

/** Login/sign-up screens: a signed-in user is sent back into the app. */
export function PublicOnlyRoute() {
  const { status } = useAuth()
  const [params] = useSearchParams()

  if (status === 'loading') return <SplashScreen />
  if (status === 'authenticated')
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />
  return <Outlet />
}
