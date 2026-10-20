import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { SnackbarProvider } from 'notistack'
import { useState, type ReactNode } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { createQueryClient } from './lib/query-client'
import { appTheme } from './theme/createAppTheme'
import { themeConfig } from './theme/theme.config'

/** Theme, data cache, notifications and session, in the order they depend on each other. */
export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient?: QueryClient
}) {
  const [client] = useState(() => queryClient ?? createQueryClient())
  return (
    <ThemeProvider theme={appTheme} defaultMode={themeConfig.defaultMode}>
      <CssBaseline enableColorScheme />
      <QueryClientProvider client={client}>
        <SnackbarProvider
          maxSnack={3}
          autoHideDuration={4000}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <AuthProvider>{children}</AuthProvider>
        </SnackbarProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
