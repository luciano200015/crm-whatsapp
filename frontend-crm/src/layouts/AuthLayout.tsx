import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { keyframes } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { Logo } from '../components/Logo'
import { ColorModeToggle } from '../theme/ColorModeToggle'

const float = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(24px, -32px) scale(1.08); }
`

const cardIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`

const SHAPES = [
  { size: 160, top: '12%', left: '8%', color: 'primary', delay: '0s' },
  { size: 110, top: '68%', left: '14%', color: 'secondary', delay: '-4s' },
  { size: 220, top: '58%', left: '78%', color: 'primary', delay: '-8s' },
  { size: 90, top: '18%', left: '82%', color: 'secondary', delay: '-2s' },
] as const

/**
 * Sign-in / sign-up shell: animated gradient background with floating blurred
 * shapes and a centered card with a gradient top bar. Colors come from the theme.
 */
export function AuthLayout() {
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        minHeight: '100svh',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 4,
        background: theme.custom.authBackground.light,
        ...theme.applyStyles('dark', { background: theme.custom.authBackground.dark }),
      })}
    >
      {SHAPES.map((shape, index) => (
        <Box
          key={index}
          aria-hidden
          sx={{
            position: 'absolute',
            top: shape.top,
            left: shape.left,
            width: shape.size,
            height: shape.size,
            borderRadius: '50%',
            bgcolor: `${shape.color}.main`,
            opacity: 0.18,
            filter: 'blur(2px)',
            animation: `${float} 14s ease-in-out infinite`,
            animationDelay: shape.delay,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      ))}

      <Card
        elevation={0}
        sx={(theme) => ({
          position: 'relative',
          width: '100%',
          maxWidth: 440,
          px: { xs: 3, sm: 5 },
          pt: 5,
          pb: 3,
          borderRadius: 4,
          border: 1,
          borderColor: 'divider',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 24px 64px -24px rgba(0,0,0,.35)',
          animation: `${cardIn} .35s ease-out`,
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: '0 0 auto 0',
            height: 4,
            background: theme.custom.gradient,
          },
        })}
      >
        <Outlet />
        <Stack direction="row" sx={{ justifyContent: 'center', mt: 3 }}>
          <ColorModeToggle />
        </Stack>
      </Card>
    </Box>
  )
}

/** Logo + title + optional subtitle at the top of every auth card. */
export function AuthHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', mb: 4 }}>
      <Logo />
      <Typography
        component="h1"
        variant="h5"
        sx={{ fontWeight: 300, color: 'primary.main', pt: 1 }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {subtitle}
        </Typography>
      )}
    </Stack>
  )
}
