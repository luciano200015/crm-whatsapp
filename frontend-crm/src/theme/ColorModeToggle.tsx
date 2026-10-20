import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import DesktopWindowsOutlined from '@mui/icons-material/DesktopWindowsOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { useColorScheme } from '@mui/material/styles'
import { es } from '../i18n/es'
import type { ColorMode } from './theme.config'

const NEXT: Record<ColorMode, ColorMode> = { light: 'dark', dark: 'system', system: 'light' }

const ICON: Record<ColorMode, typeof LightModeOutlined> = {
  light: LightModeOutlined,
  dark: DarkModeOutlined,
  system: DesktopWindowsOutlined,
}

/** Cycles light → dark → system. MUI persists the choice in localStorage. */
export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme()
  if (!mode) return null // not resolved yet (first render)

  const Icon = ICON[mode]
  const label = `${es.theme.label}: ${es.theme[mode]}`
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={() => setMode(NEXT[mode])} size="small">
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
