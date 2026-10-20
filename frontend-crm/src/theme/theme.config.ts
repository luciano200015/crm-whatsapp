/**
 * ─────────────────────────────────────────────────────────────
 *  Personalización del tema: el ÚNICO archivo que hay que tocar
 * ─────────────────────────────────────────────────────────────
 * Marca, logos, colores, degradados, tipografía y forma.
 * Los valores por defecto son los de la plantilla de Vite.
 *
 * Algunos valores se pueden sobrescribir sin tocar código con variables
 * VITE_* en un archivo .env (ver .env.example).
 */
import reactLogo from '../assets/react.svg'
import viteLogo from '../assets/vite.svg'

export type ColorMode = 'light' | 'dark' | 'system'

export interface ThemeConfig {
  brand: {
    /** Nombre mostrado en títulos, AppBar y pantallas de acceso. */
    name: string
    /** Frase bajo el título en las pantallas de acceso. */
    tagline: string
    /** Logo principal (URL o import de un asset). */
    logo: string
    /** Logo secundario opcional, mostrado junto al principal. */
    secondaryLogo?: string
    logoHeight: number
  }
  palette: {
    primary: { light: string; dark: string }
    secondary: { light: string; dark: string }
    background: {
      light: { default: string; paper: string }
      dark: { default: string; paper: string }
    }
  }
  /** Degradado de botones principales y de la barra superior de la tarjeta. */
  gradient: { from: string; to: string; angle: number }
  /** Fondo de las pantallas de login/registro. */
  authBackground: { light: string; dark: string }
  typography: { fontFamily: string }
  shape: { borderRadius: number }
  /** Modo inicial si el usuario no eligió uno: 'light' | 'dark' | 'system'. */
  defaultMode: ColorMode
}

const env = import.meta.env

export const themeConfig: ThemeConfig = {
  brand: {
    name: env.VITE_BRAND_NAME ?? 'Vite + React',
    tagline: env.VITE_BRAND_TAGLINE ?? 'Tu CRM, en un solo lugar',
    logo: env.VITE_BRAND_LOGO_URL ?? viteLogo,
    secondaryLogo: env.VITE_BRAND_LOGO_URL ? undefined : reactLogo,
    logoHeight: 44,
  },
  palette: {
    // Morado de acento de la plantilla de Vite (claro / oscuro).
    primary: {
      light: env.VITE_PRIMARY_COLOR ?? '#aa3bff',
      dark: env.VITE_PRIMARY_COLOR ?? '#c084fc',
    },
    // Cian del logo de Vite.
    secondary: { light: '#00a6db', dark: '#47bfff' },
    background: {
      light: { default: '#f7f7fb', paper: '#ffffff' },
      dark: { default: '#16171d', paper: '#1f2028' },
    },
  },
  gradient: { from: '#863bff', to: '#47bfff', angle: 120 },
  authBackground: {
    light:
      'radial-gradient(1200px 600px at 10% 0%, rgba(170,59,255,0.12), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgba(71,191,255,0.14), transparent 60%), #f7f7fb',
    dark: 'radial-gradient(1200px 600px at 10% 0%, rgba(134,59,255,0.25), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgba(71,191,255,0.18), transparent 60%), #0e0f14',
  },
  typography: {
    fontFamily: '"Public Sans", system-ui, "Segoe UI", Roboto, sans-serif',
  },
  shape: { borderRadius: 10 },
  defaultMode: (env.VITE_DEFAULT_COLOR_MODE as ColorMode | undefined) ?? 'system',
}
