import AddRounded from '@mui/icons-material/AddRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import EmojiEmotionsOutlined from '@mui/icons-material/EmojiEmotionsOutlined'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  FormControlLabel,
  IconButton,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type TextFieldProps,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { es } from '../../../i18n/es'
import { VariableButton } from '../VariableButton'

const EmojiPanel = lazy(() => import('../../inbox/EmojiPanel'))

const t = es.chatbots.node

type FieldProps = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  max: number
  onValue: (value: string) => void
}

/** A text field that shows how much of WhatsApp's limit is used. */
export function LimitedField({ value, max, onValue, inputRef, ...props }: FieldProps) {
  return (
    <TextField
      size="small"
      fullWidth
      {...props}
      inputRef={inputRef}
      value={value}
      onChange={(event) => onValue(event.target.value.slice(0, max))}
      helperText={
        <Box component="span" sx={{ display: 'flex', gap: 1 }}>
          <Box component="span" sx={{ flex: 1 }}>
            {props.helperText}
          </Box>
          {t.limit(value.length, max)}
        </Box>
      }
      slotProps={{ ...props.slotProps, htmlInput: { maxLength: max } }}
    />
  )
}

/**
 * A text the customer reads, as in wasapi: an emoji button and the green
 * «Agregar variable» bar under it. Both insert where the cursor is.
 */
export function TextWithTools({
  variables = true,
  ...props
}: FieldProps & { variables?: boolean }) {
  const { value, max, onValue } = props
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const dark = useTheme().palette.mode === 'dark'
  const insert = (token: string) => {
    const at = input.current?.selectionStart ?? value.length
    const end = input.current?.selectionEnd ?? at
    onValue((value.slice(0, at) + token + value.slice(end)).slice(0, max))
  }
  return (
    <Stack spacing={0.5}>
      <LimitedField {...props} inputRef={input} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Tooltip title={t.emoji}>
          <IconButton
            size="small"
            aria-label={t.emoji}
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <EmojiEmotionsOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        {variables && (
          <Box sx={{ flex: 1 }}>
            <VariableButton onInsert={insert} />
          </Box>
        )}
      </Stack>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Suspense fallback={<CircularProgress size={24} sx={{ m: 2 }} />}>
          {anchor && (
            <EmojiPanel
              dark={dark}
              onPick={(emoji) => {
                insert(emoji)
                setAnchor(null)
              }}
            />
          )}
        </Suspense>
      </Popover>
    </Stack>
  )
}

export function Section({
  title,
  help,
  children,
}: {
  title: string
  help?: string
  children: ReactNode
}) {
  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {help && (
          <Typography variant="caption" color="text.secondary" component="p">
            {help}
          </Typography>
        )}
      </Box>
      {children}
    </Stack>
  )
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton size="small" aria-label={label} onClick={onClick} sx={{ mt: 0.5 }}>
      <CloseRounded fontSize="small" />
    </IconButton>
  )
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box>
      <Button size="small" startIcon={<AddRounded />} onClick={onClick}>
        {label}
      </Button>
    </Box>
  )
}

/** "Enviar mensaje y saltar al siguiente nodo", or wait for an answer. */
export function JumpField({
  wait,
  onChange,
}: {
  wait: boolean
  onChange: (changes: { wait: boolean }) => void
}) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={!wait}
            onChange={(event) => onChange({ wait: !event.target.checked })}
          />
        }
        label={t.jump}
      />
      <Typography variant="caption" color="text.secondary" component="p">
        {wait ? t.waitHelp : t.jumpHelp}
      </Typography>
    </Box>
  )
}

/** «Opciones avanzadas»: what most cards never need, folded away. */
export function Advanced({
  children,
  defaultOpen = false,
}: {
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Button
        fullWidth
        color="inherit"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        endIcon={
          <ExpandMoreRounded
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
          />
        }
        sx={{ justifyContent: 'space-between', px: 1.5, fontWeight: 600 }}
      >
        {t.advanced}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={2} sx={{ p: 1.5, pt: 0.5 }}>
          {children}
        </Stack>
      </Collapse>
    </Box>
  )
}

/** A folding section with a count, like wasapi's «Cabeceras» or «Parámetros». */
export function Folding({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(count > 0)
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Button
        fullWidth
        color="inherit"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        endIcon={
          <ExpandMoreRounded
            sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
          />
        }
        sx={{ justifyContent: 'space-between', px: 1.5, fontWeight: 600 }}
      >
        {count > 0 ? `${title} (${count})` : title}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1.25} sx={{ p: 1.5, pt: 0.5 }}>
          {children}
        </Stack>
      </Collapse>
    </Box>
  )
}

/** Rows of two texts (key and value, path and variable…), with add and remove. */
export function PairList<T extends Record<keyof T, string>>({
  rows,
  first,
  second,
  max,
  addLabel,
  onChange,
}: {
  rows: T[]
  first: { key: keyof T & string; label: string; max: number }
  second: { key: keyof T & string; label: string; max: number }
  max: number
  addLabel: string
  onChange: (rows: T[]) => void
}) {
  const set = (index: number, key: string, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  return (
    <>
      {rows.map((row, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            label={first.label}
            value={row[first.key]}
            onChange={(event) => set(index, first.key, event.target.value.slice(0, first.max))}
          />
          <TextField
            size="small"
            fullWidth
            label={second.label}
            value={row[second.key]}
            onChange={(event) => set(index, second.key, event.target.value.slice(0, second.max))}
          />
          <RemoveButton
            label={`${t.removeOption} ${first.label} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </Stack>
      ))}
      {rows.length < max && (
        <AddButton
          label={addLabel}
          onClick={() => onChange([...rows, { [first.key]: '', [second.key]: '' } as unknown as T])}
        />
      )}
    </>
  )
}
