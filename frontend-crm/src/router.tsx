import { createBrowserRouter, Navigate } from 'react-router'
import { ProtectedRoute, PublicOnlyRoute, RequirePasswordChanged } from './auth/routes'
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
              { path: '/team', element: <Navigate to="/team/members" replace /> },
              {
                lazy: async () => ({
                  Component: (await import('./pages/app/team/TeamPage')).TeamPage,
                }),
                children: [
                  {
                    path: '/team/members',
                    lazy: async () => ({
                      Component: (await import('./pages/app/team/MembersPage')).MembersPage,
                    }),
                  },
                  {
                    path: '/team/roles',
                    lazy: async () => ({
                      Component: (await import('./pages/app/team/RolesPage')).RolesPage,
                    }),
                  },
                ],
              },
              {
                path: '/billing',
                lazy: async () => ({
                  Component: (await import('./pages/app/BillingPage')).BillingPage,
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
