import { useQuery } from '@tanstack/react-query'
import { meQueryKey, usersApi } from '../lib/api/users'
import { useAuth } from './auth-context'

/** The signed-in user's profile, workspaces, roles and permissions. */
export function useMe() {
  const { status } = useAuth()
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => usersApi.me(),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  })
}
