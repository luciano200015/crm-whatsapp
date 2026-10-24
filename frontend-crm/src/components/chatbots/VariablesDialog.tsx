import AddRounded from '@mui/icons-material/AddRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import type { BotVariable, VariableType } from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'

const t = es.chatbots.variables
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/
const NUMBER = /^-?\d+([.,]\d+)?$/

const EMPTY: BotVariable = { name: '', type: 'text', defaultValue: '', description: '' }

/** "Variables": the contact's data and the variables created for this bot. */
export function VariablesDialog({
  variables,
  contactVariables,
  onClose,
  onSave,
}: {
  variables: BotVariable[]
  contactVariables: string[]
  onClose: () => void
  onSave: (variables: BotVariable[]) => Promise<void>
}) {
  // The variable being written: a new one (index -1) or one of the list.
  const [form, setForm] = useState<{ index: number; value: BotVariable } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (next: BotVariable[]) => {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
      setForm(null)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const value = form?.value
  const taken =
    !!value &&
    [
      ...contactVariables,
      ...variables.filter((_, index) => index !== form.index).map((v) => v.name),
    ].some((name) => name.toLowerCase() === value.name.toLowerCase())
  const nameError = !!value && value.name !== '' && (!NAME.test(value.name) || taken)
  const defaultError =
    !!value &&
    value.type === 'number' &&
    value.defaultValue !== '' &&
    !NUMBER.test(value.defaultValue)
  const set = (changes: Partial<BotVariable>) =>
    setForm((current) => current && { ...current, value: { ...current.value, ...changes } })

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
        <DataObjectRounded color="primary" />
        <Box sx={{ flex: 1 }}>{t.title}</Box>
        <IconButton aria-label={es.chatbots.editor.close} onClick={onClose} disabled={busy}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t.help}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t.contact}
            </Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {contactVariables.map((name) => (
                <Chip
                  key={name}
                  size="small"
                  variant="outlined"
                  label={`${t.contactLabels[name] ?? name} · {{${name}}}`}
                />
              ))}
            </Stack>
          </Box>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              {t.mine}
            </Typography>
            <Button
              size="small"
              startIcon={<AddRounded />}
              disabled={busy || !!form}
              onClick={() => setForm({ index: -1, value: EMPTY })}
            >
              {t.add}
            </Button>
          </Stack>
          {form && value && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {form.index < 0 ? t.add : t.edit(variables[form.index]?.name ?? '')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    size="small"
                    fullWidth
                    autoFocus
                    label={t.name}
                    value={value.name}
                    error={nameError}
                    helperText={t.nameHelp}
                    onChange={(event) =>
                      set({ name: event.target.value.replace(/\s/g, '_').slice(0, 31) })
                    }
                  />
                  <TextField
                    select
                    size="small"
                    label={t.type}
                    value={value.type}
                    sx={{ minWidth: 180 }}
                    onChange={(event) =>
                      set({
                        type: event.target.value as VariableType,
                        defaultValue: event.target.value === 'boolean' ? 'false' : '',
                      })
                    }
                  >
                    {(Object.keys(t.types) as VariableType[]).map((type) => (
                      <MenuItem key={type} value={type}>
                        {t.types[type]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {value.type === 'boolean' ? (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={value.defaultValue === 'true'}
                        onChange={(event) =>
                          set({ defaultValue: event.target.checked ? 'true' : 'false' })
                        }
                      />
                    }
                    label={t.booleanDefault}
                  />
                ) : (
                  <TextField
                    size="small"
                    label={t.defaultValue}
                    value={value.defaultValue}
                    error={defaultError}
                    slotProps={{
                      htmlInput: { inputMode: value.type === 'number' ? 'decimal' : 'text' },
                    }}
                    onChange={(event) => set({ defaultValue: event.target.value.slice(0, 500) })}
                  />
                )}
                <TextField
                  size="small"
                  label={t.description}
                  value={value.description}
                  multiline
                  minRows={2}
                  onChange={(event) => set({ description: event.target.value.slice(0, 200) })}
                />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setForm(null)} disabled={busy}>
                    {es.common.cancel}
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy || !value.name || nameError || defaultError}
                    onClick={() =>
                      void save(
                        form.index < 0
                          ? [...variables, value]
                          : variables.map((item, index) => (index === form.index ? value : item)),
                      )
                    }
                  >
                    {t.save}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}
          {variables.length === 0 ? (
            <Alert severity="info">{t.empty}</Alert>
          ) : (
            <List dense disablePadding>
              {variables.map((variable, index) => (
                <ListItem
                  key={variable.name}
                  divider
                  secondaryAction={
                    <Stack direction="row">
                      <IconButton
                        size="small"
                        aria-label={t.edit(variable.name)}
                        disabled={busy || !!form}
                        onClick={() => setForm({ index, value: variable })}
                      >
                        <EditOutlined fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label={t.remove(variable.name)}
                        disabled={busy || !!form}
                        onClick={() => void save(variables.filter((_, i) => i !== index))}
                      >
                        <DeleteOutlineRounded fontSize="small" />
                      </IconButton>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={
                      <>
                        {`{{${variable.name}}}`}{' '}
                        <Chip size="small" label={t.types[variable.type]} sx={{ ml: 0.5 }} />
                      </>
                    }
                    secondary={[
                      variable.defaultValue &&
                        `${t.defaultValue}: ${
                          variable.type === 'boolean'
                            ? variable.defaultValue === 'true'
                              ? 'sí'
                              : 'no'
                            : variable.defaultValue
                        }`,
                      variable.description,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
