import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/errors'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Client errors (401/403/404…) will not change by retrying.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}
