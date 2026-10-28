import { createBrowserRouter, Navigate } from 'react-router'
import { RequirePermission } from './auth/permissions'
import { ProtectedRoute, PublicOnlyRoute, RequirePasswordChanged, TeamIndex } from './auth/routes'
import { AuthLayout } from './layouts/AuthLayout'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { PasswordRequiredPage } from './pages/auth/PasswordRequiredPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { SignUpDonePage } from './pages/auth/SignUpDonePage'
import { SignUpPage } from './pages/auth/SignUpPage'
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage'
import { NotFoundPage } from './pages/NotFoundPage'

export const routes = [
  {
    element: <AuthLayout />,
    children: [
      {
        // Only for visitors: a signed-in user is redirected into the app.
        element: <PublicOnlyRoute />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/sign-up', element: <SignUpPage /> },
          { path: '/sign-up/done', element: <SignUpDonePage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Email links may be opened signed in or not, even on another device.
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: '/account/password-required', element: <PasswordRequiredPage /> }],
      },
      {
        element: <RequirePasswordChanged />,
        children: [
          {
            // The signed-in area is loaded on demand so the login screen stays light.
            lazy: async () => ({ Component: (await import('./layouts/AppLayout')).AppLayout }),
            children: [
              {
                path: '/',
                lazy: async () => ({
                  Component: (await import('./pages/app/DashboardPage')).DashboardPage,
                }),
              },
              { path: '/team', element: <TeamIndex /> },
              {
                element: <RequirePermission anyOf={['messages.read']} />,
                children: [
                  {
                    path: '/inbox',
                    lazy: async () => ({
                      Component: (await import('./pages/app/inbox/InboxPage')).InboxPage,
                    }),
                  },
                ],
              },
              // Now in the inbox: «Configuración del módulo de chat» and the chat's quick replies.
              { path: '/inbox/auto-assignment', element: <Navigate to="/inbox" replace /> },
              { path: '/quick-replies', element: <Navigate to="/inbox" replace /> },
              {
                element: <RequirePermission anyOf={['funnels.read']} />,
                children: [
                  {
                    path: '/funnels/:funnelId?',
                    lazy: async () => ({
                      Component: (await import('./pages/app/funnels/FunnelBoardPage'))
                        .FunnelBoardPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['chatbots.manage']} />,
                children: [
                  {
                    path: '/automation/chatbots',
                    lazy: async () => ({
                      Component: (await import('./pages/app/automation/ChatbotsPage')).ChatbotsPage,
                    }),
                  },
                  {
                    path: '/automation/chatbots/:chatbotId',
                    lazy: async () => ({
                      Component: (await import('./pages/app/automation/ChatbotEditorPage'))
                        .ChatbotEditorPage,
                    }),
                  },
                ],
              },
              { path: '/team/members', element: <Navigate to="/team/agents" replace /> },
              {
                element: <RequirePermission anyOf={['members.read']} />,
                children: [
                  {
                    path: '/team/agents',
                    lazy: async () => ({
                      Component: (await import('./pages/app/team/AgentsPage')).AgentsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['roles.read']} />,
                children: [
                  {
                    path: '/team/roles',
                    lazy: async () => ({
                      Component: (await import('./pages/app/team/RolesPage')).RolesPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['contacts.read']} />,
                children: [
                  {
                    path: '/contacts',
                    lazy: async () => ({
                      Component: (await import('./pages/app/contacts/ContactsPage')).ContactsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['tags.manage']} />,
                children: [
                  {
                    path: '/contacts/tags',
                    lazy: async () => ({
                      Component: (await import('./pages/app/contacts/TagsPage')).TagsPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['channels.read']} />,
                children: [
                  {
                    path: '/channels/lines',
                    lazy: async () => ({
                      Component: (await import('./pages/app/channels/LinesPage')).LinesPage,
                    }),
                  },
                ],
              },
              {
                element: <RequirePermission anyOf={['billing.read']} />,
                children: [
                  {
                    path: '/billing',
                    lazy: async () => ({
                      Component: (await import('./pages/app/BillingPage')).BillingPage,
                    }),
                  },
                ],
              },
              {
                path: '/forbidden',
                lazy: async () => ({
                  Component: (await import('./pages/app/ForbiddenPage')).ForbiddenPage,
                }),
              },
              {
                path: '/account/profile',
                lazy: async () => ({
                  Component: (await import('./pages/app/ProfilePage')).ProfilePage,
                }),
              },
              {
                path: '/account/security',
                lazy: async () => ({
                  Component: (await import('./pages/app/SecurityPage')).SecurityPage,
                }),
              },
            ],
          },
        ],
      },
    ],
  },
  // Public for everyone, signed in or not.
  {
    path: '/pricing',
    lazy: async () => ({ Component: (await import('./pages/PricingPage')).PricingPage }),
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
