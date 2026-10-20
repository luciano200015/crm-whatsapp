import { useQuery } from '@tanstack/react-query'
import { billingApi, catalogQueryKey } from '../../lib/api/billing'

/** Public plan catalog; rarely changes, so it is cached for a while. */
export function useCatalog() {
  return useQuery({
    queryKey: catalogQueryKey,
    queryFn: () => billingApi.catalog(),
    staleTime: 10 * 60_000,
  })
}
