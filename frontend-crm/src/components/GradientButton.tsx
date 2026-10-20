import Button, { type ButtonProps } from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { Link as RouterLink } from 'react-router'

type GradientButtonProps = ButtonProps & {
  loading?: boolean
  /** Renders the button as an in-app link. */
  to?: string
}

/** Primary call-to-action with the brand gradient (theme.custom.gradient). */
export function GradientButton({
  loading,
  children,
  disabled,
  sx,
  to,
  ...props
}: GradientButtonProps) {
  const link = to ? { component: RouterLink, to } : {}
  return (
    <Button
      variant="contained"
      size="large"
      fullWidth
      disabled={disabled || loading}
      {...link}
      {...props}
      sx={[
        (theme) => ({
          background: theme.custom.gradient,
          color: 'common.white',
          fontWeight: 700,
          boxShadow: `0 8px 24px -10px ${theme.vars?.palette.primary.main ?? theme.palette.primary.main}`,
          transition: 'filter .2s ease, transform .2s ease',
          '&:hover': { filter: 'brightness(1.08)', transform: 'translateY(-1px)' },
          '&.Mui-disabled': { color: 'common.white', opacity: 0.6 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {loading ? <CircularProgress size={22} color="inherit" /> : children}
    </Button>
  )
}
