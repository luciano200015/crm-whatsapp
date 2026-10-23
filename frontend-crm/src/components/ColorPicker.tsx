import CheckRounded from '@mui/icons-material/CheckRounded'
import ColorizeOutlined from '@mui/icons-material/ColorizeOutlined'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import PaletteOutlined from '@mui/icons-material/PaletteOutlined'
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'

/** A wide palette, as in wasapi; any other color comes from the free picker. */
const PALETTE = [
  '#2ecc71',
  '#2e7d32',
  '#43a047',
  '#7cb342',
  '#81c784',
  '#9ccc65',
  '#558b2f',
  '#00e676',
  '#76ff03',
  '#c6ff00',
  '#1e88e5',
  '#3f51b5',
  '#303f9f',
  '#4fc3f7',
  '#7986cb',
  '#00bcd4',
  '#009688',
  '#4db6ac',
  '#00796b',
  '#00e5ff',
  '#1de9b6',
  '#5c6bc0',
  '#7b1fa2',
  '#8e24aa',
  '#ab47bc',
  '#d500f9',
  '#ad1457',
  '#d81b60',
  '#f06292',
  '#e53935',
  '#c62828',
  '#f4511e',
  '#e64a19',
  '#ff7043',
  '#ffab91',
  '#ef6c00',
  '#f9a825',
  '#ffb300',
  '#ffd54f',
  '#fb8c00',
  '#fdd835',
  '#ffeb3b',
  '#cddc39',
  '#eeff41',
  '#6d4c41',
  '#795548',
  '#8d6e63',
  '#546e7a',
  '#78909c',
  '#90a4ae',
  '#455a64',
  '#212121',
  '#9e9e9e',
  '#e0f2f1',
] as const

const HEX = /^#[0-9a-f]{6}$/i

interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>
}
type WithEyeDropper = Window & { EyeDropper?: new () => EyeDropperApi }

function Swatch({
  color,
  selected,
  size,
  onClick,
}: {
  color: string
  selected: boolean
  size: number
  onClick: () => void
}) {
  return (
    <ButtonBase
      aria-label={color}
      aria-pressed={selected}
      onClick={onClick}
      sx={{
        width: size,
        height: size,
        borderRadius: 1,
        bgcolor: color,
        color: '#fff',
        border: 1,
        borderColor: 'divider',
        outline: selected ? 2 : 0,
        outlineColor: 'text.primary',
        outlineOffset: 1,
      }}
    >
      {selected && (
        <CheckRounded sx={{ fontSize: size * 0.6, filter: 'drop-shadow(0 0 1px #000)' }} />
      )}
    </ButtonBase>
  )
}

/**
 * Picks any color: a palette, a free picker, the hex code and (where the
 * browser allows it) the eyedropper. Always hands back #rrggbb.
 */
export function ColorPanel({
  value,
  onChange,
  label = 'Color',
}: {
  value: string
  onChange: (color: string) => void
  label?: string
}) {
  const [typed, setTyped] = useState(value)
  const [shown, setShown] = useState(value)
  // Follows changes made from outside (palette, picker, a reset).
  if (shown !== value) {
    setShown(value)
    setTyped(value)
  }
  const pick = (color: string) => onChange(color.toLowerCase())
  const dropper = (window as WithEyeDropper).EyeDropper
  const typedValid = HEX.test(typed)
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          label={label}
          value={typed}
          error={!typedValid}
          helperText={typedValid ? undefined : 'Usa el formato #RRGGBB'}
          onChange={(event) => {
            const next = event.target.value.trim()
            setTyped(next)
            if (HEX.test(next)) pick(next)
          }}
          slotProps={{ htmlInput: { maxLength: 7, 'aria-label': `${label} en hexadecimal` } }}
          sx={{ flex: 1 }}
        />
        <Box
          aria-hidden
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1,
            bgcolor: value,
            border: 1,
            borderColor: 'divider',
          }}
        />
      </Stack>
      <Box
        sx={{
          '& .react-colorful': { width: '100%', height: 160 },
          '& .react-colorful__saturation': { borderRadius: '6px 6px 0 0' },
          '& .react-colorful__last-control': { borderRadius: '0 0 6px 6px' },
        }}
      >
        <HexColorPicker color={value} onChange={pick} aria-label="Selector de color" />
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Paleta
        </Typography>
        {dropper && (
          <Tooltip title="Tomar un color de la pantalla">
            <IconButton
              size="small"
              aria-label="Cuentagotas"
              onClick={() => {
                void new dropper()
                  .open()
                  .then((result) => pick(result.sRGBHex))
                  .catch(() => undefined)
              }}
            >
              <ColorizeOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Box
        role="group"
        aria-label="Paleta de colores"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 0.75 }}
      >
        {PALETTE.map((color) => (
          <Swatch
            key={color}
            color={color}
            size={26}
            selected={color === value.toLowerCase()}
            onClick={() => pick(color)}
          />
        ))}
      </Box>
    </Stack>
  )
}

/** A button with the color and its code that opens the color panel, as in wasapi. */
export function ColorPicker({
  value,
  onChange,
  label = 'Color',
  disabled = false,
  emptyLabel = 'Sin color',
}: {
  value: string | null
  onChange: (color: string) => void
  label?: string
  disabled?: boolean
  /** Shown while there is no color yet. */
  emptyLabel?: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState(value ?? PALETTE[12])
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        aria-label={`${label}: ${value ?? emptyLabel}`}
        aria-haspopup="dialog"
        endIcon={<ExpandMoreRounded />}
        startIcon={
          value ? (
            <Box sx={{ width: 16, height: 16, borderRadius: 0.5, bgcolor: value }} />
          ) : (
            <PaletteOutlined />
          )
        }
        onClick={(event) => {
          setDraft(value ?? PALETTE[12])
          setAnchor(event.currentTarget)
        }}
        sx={{ fontFamily: 'monospace', textTransform: 'none' }}
      >
        {value?.toUpperCase() ?? emptyLabel}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { width: 300, p: 2 } } }}
      >
        <Stack spacing={1.5}>
          <ColorPanel value={draft} onChange={setDraft} label={label} />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setAnchor(null)}>Cancelar</Button>
            <Button
              variant="contained"
              disabled={draft === value}
              onClick={() => {
                onChange(draft)
                setAnchor(null)
              }}
            >
              Aplicar
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  )
}
