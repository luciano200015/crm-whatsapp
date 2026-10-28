import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import LinearProgress from '@mui/material/LinearProgress'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { es } from '../../i18n/es'
import {
  contactKeys,
  contactsApi,
  IMPORT_BATCH,
  type ContactField,
  type ImportResult,
  type ImportRow,
  type TagMode,
} from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import { download, MAX_IMPORT_BYTES, readSpreadsheet, toCsv } from '../../lib/spreadsheet'
import { useContactFields } from './useContacts'

const t = es.contacts.import

const BUILT_IN = ['phone', 'name', 'lastName', 'email', 'tags', 'notes'] as const
type BuiltIn = (typeof BUILT_IN)[number]
/** '' skips the column; `field:<key>` is a custom field; `new` creates one. */
type Target = BuiltIn | `field:${string}` | 'new' | ''

/** Header words that map a column by itself. */
const GUESSES: Record<BuiltIn, RegExp> = {
  phone: /^(tel[eé]fono|phone|celular|cel|m[oó]vil|whatsapp|n[uú]mero)$/i,
  name: /^(nombres?|name|first ?name|nombre completo)$/i,
  lastName: /^(apellidos?|last ?name|surname)$/i,
  email: /^(correo|e-?mail|correo electr[oó]nico)$/i,
  tags: /^(etiquetas?|tags?)$/i,
  notes: /^(notas?|notes?|observaci[oó]n(es)?)$/i,
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

function guess(header: string, fields: ContactField[], taken: Set<Target>): Target {
  const builtIn = BUILT_IN.find((target) => GUESSES[target].test(header.trim()))
  if (builtIn && !taken.has(builtIn)) return builtIn
  const field = fields.find((definition) => definition.key === fold(header))
  if (field && !taken.has(`field:${field.key}`)) return `field:${field.key}`
  return ''
}

type Step = 'file' | 'map' | 'summary' | 'running' | 'done'

/**
 * «Importar contactos» like wasapi: upload an Excel or CSV, assign each
 * column («Campos existentes», «Campos personalizados» or «Saltar
 * columna»), choose how tags combine and import. The file is read here and
 * sent in batches; phones that already exist are updated.
 */
export function ImportContactsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const fields = useContactFields(workspaceId)
  const [step, setStep] = useState<Step>('file')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [tagMode, setTagMode] = useState<TagMode>('MERGE')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)

  const choose = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!/\.(xlsx|csv)$/i.test(file.name)) return setError(t.badType)
    if (file.size > MAX_IMPORT_BYTES) return setError(t.tooBig)
    try {
      const table = await readSpreadsheet(file)
      const [head = [], ...body] = table
      if (body.length === 0) return setError(t.empty)
      const width = Math.max(head.length, ...body.map((row) => row.length))
      const names = Array.from(
        { length: width },
        (_, index) => head[index]?.trim() || `Columna ${index + 1}`,
      )
      const taken = new Set<Target>()
      setTargets(
        names.map((name) => {
          const target = guess(name, fields.data ?? [], taken)
          if (target) taken.add(target)
          return target
        }),
      )
      setFileName(file.name)
      setHeaders(names)
      setRows(body)
      setStep('map')
    } catch {
      setError(t.unreadable)
    }
  }

  const assign = async (column: number, target: Target) => {
    setError(null)
    let chosen = target
    if (target === 'new') {
      // «Crear campo personalizado» named like the column.
      try {
        const created = await contactsApi.createField(workspaceId, {
          label: headers[column] ?? '',
          type: 'TEXT',
        })
        await client.invalidateQueries({ queryKey: contactKeys.fields(workspaceId) })
        chosen = `field:${created.key}`
      } catch (caught: unknown) {
        setError(errorMessage(caught))
        return
      }
    }
    // A field takes one column: the one that had it is skipped.
    setTargets((current) =>
      current.map((value, index) =>
        index === column ? chosen : value === chosen && chosen !== '' ? '' : value,
      ),
    )
  }

  const rowOf = (cells: string[]): ImportRow => {
    const row: ImportRow = { phone: '' }
    const fieldValues: Record<string, string> = {}
    let lastName = ''
    targets.forEach((target, index) => {
      const value = (cells[index] ?? '').trim()
      if (!target || target === 'new' || !value) return
      if (target === 'phone') row.phone = value
      else if (target === 'name') row.name = value
      else if (target === 'lastName') lastName = value
      else if (target === 'email') row.email = value
      else if (target === 'notes') row.notes = value
      else if (target === 'tags')
        row.tags = value
          .split(/[,;|]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      else fieldValues[target.slice('field:'.length)] = value
    })
    if (lastName) row.name = [row.name, lastName].filter(Boolean).join(' ')
    if (Object.keys(fieldValues).length > 0) row.fields = fieldValues
    return row
  }

  const run = async () => {
    setStep('running')
    setProgress(0)
    const total: ImportResult = { created: 0, updated: 0, failed: [] }
    for (let start = 0; start < rows.length; start += IMPORT_BATCH) {
      const batch = rows.slice(start, start + IMPORT_BATCH)
      try {
        const answer = await contactsApi.importRows(workspaceId, batch.map(rowOf), tagMode)
        total.created += answer.created
        total.updated += answer.updated
        total.failed.push(
          ...answer.failed.map((failure) => ({ ...failure, index: start + failure.index })),
        )
      } catch {
        // The batch failed as a whole (network, session): its rows are listed.
        total.failed.push(
          ...batch.map((cells, offset) => ({
            index: start + offset,
            phone: rowOf(cells).phone,
            code: 'REQUEST_FAILED',
          })),
        )
      }
      setProgress(Math.min(start + IMPORT_BATCH, rows.length))
    }
    setResult(total)
    setStep('done')
    void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
  }

  const downloadFailures = () => {
    if (!result) return
    const table = [
      [...headers, t.reason],
      ...result.failed.map((failure) => [
        ...headers.map((_, index) => rows[failure.index]?.[index] ?? ''),
        t.reasons[failure.code] ?? failure.code,
      ]),
    ]
    download(
      new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }),
      'contactos-con-error.csv',
    )
  }

  const phoneMapped = targets.includes('phone')
  const mapped = targets.filter((target) => target !== '').length
  const busy = step === 'running'
  const label = (target: Target) =>
    target.startsWith('field:')
      ? (fields.data?.find((field) => `field:${field.key}` === target)?.label ?? target)
      : t.targets[target as BuiltIn]

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>{t.title}</DialogTitle>
      <DialogContent>
        <Stepper
          activeStep={step === 'file' ? 0 : step === 'map' ? 1 : 2}
          sx={{ mb: 3 }}
          alternativeLabel
        >
          {t.steps.map((name) => (
            <Step key={name}>
              <StepLabel>{name}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 'file' && (
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 3 }}>
            <UploadFileOutlined sx={{ fontSize: 48, color: 'text.secondary' }} />
            <Typography color="text.secondary" sx={{ maxWidth: 460 }}>
              {t.fileHelp}
            </Typography>
            <Button variant="contained" component="label">
              {t.chooseFile}
              <input
                hidden
                type="file"
                aria-label={t.fileLabel}
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  void choose(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </Button>
          </Stack>
        )}

        {step === 'map' && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 600 }}>{fileName}</Typography>
              <Chip size="small" label={t.rows(rows.length)} />
            </Stack>
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t.column}</TableCell>
                    <TableCell>{t.sample}</TableCell>
                    <TableCell sx={{ minWidth: 240 }}>{t.assign}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {headers.map((header, column) => (
                    <TableRow key={column}>
                      <TableCell sx={{ fontWeight: 600 }}>{header}</TableCell>
                      <TableCell sx={{ color: 'text.secondary', maxWidth: 220 }}>
                        <Typography variant="body2" noWrap>
                          {rows
                            .slice(0, 3)
                            .map((row) => row[column] ?? '')
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          value={targets[column] ?? ''}
                          onChange={(event) => void assign(column, event.target.value as Target)}
                          slotProps={{
                            htmlInput: { 'aria-label': `${t.assign}: ${header}` },
                            select: { displayEmpty: true },
                          }}
                        >
                          <MenuItem value="">
                            <em>{t.skip}</em>
                          </MenuItem>
                          <ListSubheader>{t.existing}</ListSubheader>
                          {BUILT_IN.map((target) => (
                            <MenuItem key={target} value={target}>
                              {t.targets[target]}
                            </MenuItem>
                          ))}
                          <ListSubheader>{t.custom}</ListSubheader>
                          {(fields.data ?? []).map((field) => (
                            <MenuItem key={field.id} value={`field:${field.key}`}>
                              {field.label}
                            </MenuItem>
                          ))}
                          <MenuItem value="new">{t.createField(header)}</MenuItem>
                        </TextField>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {targets.includes('tags') && (
              <Box>
                <FormLabel sx={{ fontSize: 13, fontWeight: 600 }}>{t.tagMode}</FormLabel>
                <RadioGroup
                  row
                  value={tagMode}
                  onChange={(event) => setTagMode(event.target.value as TagMode)}
                >
                  <FormControlLabel
                    value="REPLACE"
                    control={<Radio />}
                    label={`${t.replaceTags}: ${t.replaceHelp}`}
                  />
                  <FormControlLabel
                    value="MERGE"
                    control={<Radio />}
                    label={`${t.mergeTags}: ${t.mergeHelp}`}
                  />
                </RadioGroup>
              </Box>
            )}
            {!phoneMapped && <Alert severity="warning">{t.phoneRequired}</Alert>}
          </Stack>
        )}

        {step === 'summary' && (
          <Stack spacing={2}>
            <Typography>{t.summary(rows.length)}</Typography>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t.mapped}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {headers.flatMap((header, column) => {
                  const target = targets[column] ?? ''
                  return target
                    ? [<Chip key={column} label={`${header} → ${label(target)}`} />]
                    : []
                })}
              </Stack>
              {headers.length > mapped && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t.skipped(headers.length - mapped)}
                </Typography>
              )}
            </Box>
            {targets.includes('tags') && (
              <Typography variant="body2">
                {t.tagMode}: {tagMode === 'REPLACE' ? t.replaceTags : t.mergeTags}
              </Typography>
            )}
          </Stack>
        )}

        {step === 'running' && (
          <Stack spacing={1.5} sx={{ py: 3 }}>
            <Typography>{t.running(progress, rows.length)}</Typography>
            <LinearProgress variant="determinate" value={(progress / rows.length) * 100} />
          </Stack>
        )}

        {step === 'done' && result && (
          <Stack spacing={2}>
            <Alert severity={result.failed.length > 0 ? 'warning' : 'success'}>
              {t.done}: {t.created(result.created)}, {t.updated(result.updated)},{' '}
              {t.failed(result.failed.length)}.
            </Alert>
            {result.failed.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t.failures}
                </Typography>
                <Stack spacing={0.5} sx={{ maxHeight: 200, overflow: 'auto' }}>
                  {result.failed.slice(0, 50).map((failure) => (
                    <Typography key={failure.index} variant="body2">
                      {/* +2: the header is row 1 of the file. */}
                      {t.row(failure.index + 2)} · {failure.phone || '—'} ·{' '}
                      {t.reasons[failure.code] ?? failure.code}
                    </Typography>
                  ))}
                </Stack>
                <Button sx={{ mt: 1 }} variant="outlined" onClick={downloadFailures}>
                  {t.downloadFailures}
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {step === 'done' ? (
          <Button variant="contained" onClick={onClose}>
            {t.finish}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {es.common.cancel}
            </Button>
            {step === 'map' && (
              <Button
                variant="contained"
                disabled={!phoneMapped}
                onClick={() => setStep('summary')}
              >
                {t.next}
              </Button>
            )}
            {step === 'summary' && (
              <>
                <Button onClick={() => setStep('map')}>{t.back}</Button>
                <Button variant="contained" color="success" onClick={() => void run()}>
                  {t.start}
                </Button>
              </>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
