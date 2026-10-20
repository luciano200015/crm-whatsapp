import { createTheme } from '@mui/material/styles'
import { themeConfig, type ThemeConfig } from './theme.config'

declare module '@mui/material/styles' {
  interface Theme {
    custom: {
      gradient: string
      authBackground: { light: string; dark: string }
    }
  }
  interface ThemeOptions {
    custom?: Theme['custom']
  }
}

/**
 * Builds the MUI theme from theme.config.ts. Light and dark palettes are both
 * defined (CSS variables), so switching mode never re-creates the theme.
 * Components must use theme tokens only, never hard-coded colors.
 */
export function createAppTheme(config: ThemeConfig = themeConfig) {
  const { palette, gradient } = config

  return createTheme({
    cssVariables: { colorSchemeSelector: 'data-color-scheme' },
    colorSchemes: {
      light: {
        palette: {
          primary: { main: palette.primary.light },
          secondary: { main: palette.secondary.light },
          background: palette.background.light,
        },
      },
      dark: {
        palette: {
          primary: { main: palette.primary.dark },
          secondary: { main: palette.secondary.dark },
          background: palette.background.dark,
        },
      },
    },
    typography: {
      fontFamily: config.typography.fontFamily,
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: config.shape.borderRadius },
    custom: {
      gradient: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`,
      authBackground: config.authBackground,
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { paddingBlock: 10 } },
      },
      MuiTextField: {
        defaultProps: { fullWidth: true, size: 'small' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            // CSS variable: follows the active light/dark scheme.
            backgroundColor: (theme.vars ?? theme).palette.action.hover,
          }),
        },
      },
      MuiCard: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
    },
  })
}

export const appTheme = createAppTheme()
