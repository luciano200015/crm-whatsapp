import AddRounded from '@mui/icons-material/AddRounded'
import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  type TextFieldProps,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { es } from '../../i18n/es'
import { chatbotsApi, type NodeData, type NodeKind } from '../../lib/api/chatbots'
import { errorMessage } from '../../lib/api/errors'
import type { TagSummary } from '../../lib/api/types'
import { LIMITS, newId, type EditorNode } from './flow-model'
import { NodeIcon } from './node-icons'
import { ScheduleEditor } from './ScheduleEditor'

const t = es.chatbots.node

/** A text field that shows how much of WhatsApp's limit is used. */
function LimitedField({
  value,
  max,
  onValue,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  max: number
  onValue: (value: string) => void
}) {
  return (
    <TextField
      size="small"
      fullWidth
      {...props}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton size="small" aria-label={label} onClick={onClick}>
      <CloseRounded fontSize="small" />
    </IconButton>
  )
}

/** Header, body and footer of interactive messages. */
function InteractiveTexts({
  data,
  onChange,
}: {
  data: { header: string; body: string; footer: string }
  onChange: (changes: Partial<{ header: string; body: string; footer: string }>) => void
}) {
  return (
    <>
      <LimitedField
        label={t.header}
        value={data.header}
        max={LIMITS.header}
        onValue={(header) => onChange({ header })}
      />
      <LimitedField
        label={t.body}
        value={data.body}
        max={LIMITS.body}
        multiline
        minRows={3}
        required
        helperText={t.variables}
        onValue={(body) => onChange({ body })}
      />
      <LimitedField
        label={t.footer}
        value={data.footer}
        max={LIMITS.footer}
        onValue={(footer) => onChange({ footer })}
      />
    </>
  )
}

function InvalidText({ value, onValue }: { value: string; onValue: (value: string) => void }) {
  return (
    <LimitedField
      label={t.invalidText}
      placeholder="No entendí tu respuesta. Elige una de las opciones, por favor."
      value={value}
      max={LIMITS.invalidText}
      helperText={t.invalidHelp}
      onValue={onValue}
    />
  )
}

export interface Member {
  membershipId: string
  name: string
}

/**
 * Settings of the selected node, in a side panel. Every change applies to
 * the canvas at once; "Guardar" stores the flow.
 */
export function NodeEditor({
  workspaceId,
  chatbotId,
  node,
  tags,
  members,
  onChange,
  onDelete,
  onClose,
}: {
  workspaceId: string
  chatbotId: string
  node: EditorNode
  tags: TagSummary[]
  members: Member[]
  onChange: (data: Record<string, unknown>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const kind = node.type as NodeKind
  return (
    <Stack sx={{ height: '100%' }} aria-label={es.chatbots.editor.editNode}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <NodeIcon kind={kind} color="primary" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>
            {es.chatbots.nodes[kind].label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {es.chatbots.nodes[kind].help}
          </Typography>
        </Box>
        <IconButton aria-label={es.chatbots.editor.close} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>
      <Stack spacing={2} sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        <NodeForm
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          kind={kind}
          data={node.data}
          tags={tags}
          members={members}
          onChange={(changes) => onChange({ ...node.data, ...changes })}
        />
      </Stack>
      {kind !== 'start' && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button color="error" startIcon={<DeleteOutlineRounded />} onClick={onDelete}>
            {es.chatbots.editor.deleteNode}
          </Button>
        </Box>
      )}
    </Stack>
  )
}

function NodeForm({
  workspaceId,
  chatbotId,
  kind,
  data,
  tags,
  members,
  onChange,
}: {
  workspaceId: string
  chatbotId: string
  kind: NodeKind
  data: Record<string, unknown>
  tags: TagSummary[]
  members: Member[]
  onChange: (changes: Record<string, unknown>) => void
}) {
  switch (kind) {
    case 'start':
    case 'end':
      return <Alert severity="info">{es.chatbots.nodes[kind].help}</Alert>
    case 'message':
      return (
        <MessageForm
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          data={data as NodeData['message']}
          onChange={onChange}
        />
      )
    case 'buttons': {
      const value = data as NodeData['buttons']
      return (
        <>
          <InteractiveTexts data={value} onChange={onChange} />
          <Section title={t.buttons}>
            {value.buttons.map((button, index) => (
              <Stack key={button.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <LimitedField
                  label={t.button(index + 1)}
                  value={button.title}
                  max={LIMITS.buttonTitle}
                  onValue={(title) =>
                    onChange({
                      buttons: value.buttons.map((item) =>
                        item.id === button.id ? { ...item, title } : item,
                      ),
                    })
                  }
                />
                <RemoveButton
                  label={`${t.removeOption} ${t.button(index + 1)}`}
                  onClick={() =>
                    onChange({ buttons: value.buttons.filter((item) => item.id !== button.id) })
                  }
                />
              </Stack>
            ))}
            {value.buttons.length < LIMITS.buttons && (
              <Box>
                <Button
                  size="small"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    onChange({
                      buttons: [
                        ...value.buttons,
                        { id: newId('b'), title: `Opción ${value.buttons.length + 1}` },
                      ],
                    })
                  }
                >
                  {t.addButton}
                </Button>
              </Box>
            )}
          </Section>
          <InvalidText
            value={value.invalidText}
            onValue={(invalidText) => onChange({ invalidText })}
          />
        </>
      )
    }
    case 'list':
      return <ListForm data={data as NodeData['list']} onChange={onChange} />
    case 'url': {
      const value = data as NodeData['url']
      return (
        <>
          <InteractiveTexts data={value} onChange={onChange} />
          <LimitedField
            label={t.urlText}
            value={value.text}
            max={LIMITS.urlText}
            required
            onValue={(text) => onChange({ text })}
          />
          <TextField
            size="small"
            label={t.url}
            value={value.url}
            required
            error={!/^https:\/\/\S+\.\S+/.test(value.url)}
            onChange={(event) => onChange({ url: event.target.value.trim().slice(0, 2000) })}
          />
        </>
      )
    }
    case 'question': {
      const value = data as NodeData['question']
      return (
        <>
          <LimitedField
            label={t.question}
            value={value.text}
            max={LIMITS.text}
            multiline
            minRows={2}
            required
            helperText={t.variables}
            onValue={(text) => onChange({ text })}
          />
          <TextField
            size="small"
            label={t.variable}
            value={value.variable}
            required
            error={!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(value.variable)}
            helperText={t.variableHelp}
            onChange={(event) =>
              onChange({ variable: event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 31) })
            }
          />
          <TextField
            select
            size="small"
            label={t.validation}
            value={value.validation}
            onChange={(event) => onChange({ validation: event.target.value })}
          >
            {(Object.keys(t.validations) as (keyof typeof t.validations)[]).map((key) => (
              <MenuItem key={key} value={key}>
                {t.validations[key]}
              </MenuItem>
            ))}
          </TextField>
          <InvalidText
            value={value.invalidText}
            onValue={(invalidText) => onChange({ invalidText })}
          />
        </>
      )
    }
    case 'condition':
      return <ConditionForm data={data as NodeData['condition']} onChange={onChange} />
    case 'hours':
      return (
        <ScheduleEditor
          value={(data as NodeData['hours']).schedule}
          onChange={(schedule) => onChange({ schedule })}
        />
      )
    case 'tags': {
      const value = data as NodeData['tags']
      const pick = (key: 'add' | 'remove', label: string) => (
        <Autocomplete
          multiple
          size="small"
          options={tags}
          value={tags.filter((tag) => value[key].includes(tag.id))}
          getOptionLabel={(tag) => tag.name}
          isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
          onChange={(_, chosen) => onChange({ [key]: chosen.map((tag) => tag.id) })}
          renderValue={(chosen, getItemProps) =>
            chosen.map((tag, index) => {
              const { key: itemKey, ...itemProps } = getItemProps({ index })
              return (
                <Chip
                  key={itemKey}
                  size="small"
                  variant="outlined"
                  label={tag.name}
                  sx={{ borderColor: tag.color, color: tag.color }}
                  {...itemProps}
                />
              )
            })
          }
          renderInput={(props) => <TextField {...props} label={label} />}
        />
      )
      return (
        <>
          {pick('add', t.addTags)}
          {pick('remove', t.removeTags)}
        </>
      )
    }
    case 'transfer': {
      const value = data as NodeData['transfer']
      return (
        <>
          <FormControl>
            <FormLabel>{t.transferTo}</FormLabel>
            <RadioGroup
              value={value.to}
              onChange={(event) =>
                onChange({
                  to: event.target.value,
                  membershipId: event.target.value === 'member' ? value.membershipId : null,
                })
              }
            >
              {(Object.keys(t.transferOptions) as (keyof typeof t.transferOptions)[]).map((key) => (
                <FormControlLabel
                  key={key}
                  value={key}
                  control={<Radio size="small" />}
                  label={t.transferOptions[key]}
                />
              ))}
            </RadioGroup>
          </FormControl>
          {value.to === 'member' && (
            <TextField
              select
              size="small"
              label={t.agent}
              value={value.membershipId ?? ''}
              onChange={(event) => onChange({ membershipId: event.target.value || null })}
            >
              {members.map((member) => (
                <MenuItem key={member.membershipId} value={member.membershipId}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <LimitedField
            label={t.transferMessage}
            value={value.message ?? t.transferMessageDefault}
            max={LIMITS.text}
            multiline
            minRows={2}
            helperText={t.transferMessageHelp}
            onValue={(message) => onChange({ message })}
          />
        </>
      )
    }
    case 'status': {
      const value = data as NodeData['status']
      return (
        <TextField
          select
          size="small"
          label={t.statusLabel}
          value={value.status}
          onChange={(event) => onChange({ status: event.target.value })}
        >
          {(Object.keys(t.statuses) as (keyof typeof t.statuses)[]).map((key) => (
            <MenuItem key={key} value={key}>
              {t.statuses[key]}
            </MenuItem>
          ))}
        </TextField>
      )
    }
  }
}

function MessageForm({
  workspaceId,
  chatbotId,
  data,
  onChange,
}: {
  workspaceId: string
  chatbotId: string
  data: NodeData['message']
  onChange: (changes: Partial<NodeData['message']>) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <LimitedField
        label={t.text}
        value={data.text}
        max={LIMITS.text}
        multiline
        minRows={4}
        helperText={t.variables}
        onValue={(text) => onChange({ text })}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {data.media ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            icon={<AttachFileRounded />}
            label={data.media.filename}
            onDelete={() => onChange({ media: null })}
            deleteIcon={<CloseRounded aria-label={t.removeFile} />}
          />
        </Stack>
      ) : (
        <Box>
          <Button
            component="label"
            size="small"
            variant="outlined"
            startIcon={<AttachFileRounded />}
            disabled={uploading}
          >
            {uploading ? t.uploading : t.attach}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/mpeg,audio/mp4,audio/ogg,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setUploading(true)
                setError(null)
                chatbotsApi
                  .uploadMedia(workspaceId, chatbotId, file)
                  .then((media) => onChange({ media }))
                  .catch((caught: unknown) => setError(errorMessage(caught)))
                  .finally(() => setUploading(false))
              }}
            />
          </Button>
        </Box>
      )}
    </>
  )
}

function ListForm({
  data,
  onChange,
}: {
  data: NodeData['list']
  onChange: (changes: Partial<NodeData['list']>) => void
}) {
  const total = data.sections.reduce((sum, section) => sum + section.rows.length, 0)
  const setSection = (id: string, changes: Partial<NodeData['list']['sections'][number]>) =>
    onChange({
      sections: data.sections.map((section) =>
        section.id === id ? { ...section, ...changes } : section,
      ),
    })
  return (
    <>
      <InteractiveTexts data={data} onChange={onChange} />
      <LimitedField
        label={t.listButton}
        value={data.button}
        max={LIMITS.listButton}
        required
        onValue={(button) => onChange({ button })}
      />
      {data.sections.map((section, index) => (
        <Section key={section.id} title={t.section(index + 1)}>
          <Stack direction="row" spacing={1}>
            <LimitedField
              label={t.sectionTitle}
              value={section.title}
              max={LIMITS.sectionTitle}
              onValue={(title) => setSection(section.id, { title })}
            />
            {data.sections.length > 1 && (
              <RemoveButton
                label={`${t.removeOption} ${t.section(index + 1)}`}
                onClick={() =>
                  onChange({ sections: data.sections.filter((item) => item.id !== section.id) })
                }
              />
            )}
          </Stack>
          {section.rows.map((row, rowIndex) => (
            <Stack key={row.id} spacing={1} sx={{ pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1}>
                <LimitedField
                  label={`${t.option} ${rowIndex + 1}`}
                  value={row.title}
                  max={LIMITS.rowTitle}
                  onValue={(title) =>
                    setSection(section.id, {
                      rows: section.rows.map((item) =>
                        item.id === row.id ? { ...item, title } : item,
                      ),
                    })
                  }
                />
                <RemoveButton
                  label={`${t.removeOption} ${t.option} ${rowIndex + 1}`}
                  onClick={() =>
                    setSection(section.id, {
                      rows: section.rows.filter((item) => item.id !== row.id),
                    })
                  }
                />
              </Stack>
              <LimitedField
                label={t.description}
                value={row.description}
                max={LIMITS.rowDescription}
                onValue={(description) =>
                  setSection(section.id, {
                    rows: section.rows.map((item) =>
                      item.id === row.id ? { ...item, description } : item,
                    ),
                  })
                }
              />
            </Stack>
          ))}
          {total < LIMITS.listRows && (
            <Box>
              <Button
                size="small"
                startIcon={<AddRounded />}
                onClick={() =>
                  setSection(section.id, {
                    rows: [
                      ...section.rows,
                      { id: newId('r'), title: `Opción ${total + 1}`, description: '' },
                    ],
                  })
                }
              >
                {t.addRow}
              </Button>
            </Box>
          )}
        </Section>
      ))}
      {total < LIMITS.listRows && (
        <Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddRounded />}
            onClick={() =>
              onChange({
                sections: [
                  ...data.sections,
                  {
                    id: newId('s'),
                    title: '',
                    rows: [{ id: newId('r'), title: `Opción ${total + 1}`, description: '' }],
                  },
                ],
              })
            }
          >
            {t.addSection}
          </Button>
        </Box>
      )}
      <Divider />
      <InvalidText value={data.invalidText} onValue={(invalidText) => onChange({ invalidText })} />
    </>
  )
}

function ConditionForm({
  data,
  onChange,
}: {
  data: NodeData['condition']
  onChange: (changes: Partial<NodeData['condition']>) => void
}) {
  const setRule = (id: string, changes: Partial<NodeData['condition']['rules'][number]>) =>
    onChange({
      rules: data.rules.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule)),
    })
  return (
    <Section title={t.rules}>
      {data.rules.map((rule, index) => (
        <Stack
          key={rule.id}
          spacing={1}
          sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
        >
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              {t.rule(index + 1)}
            </Typography>
            <RemoveButton
              label={`${t.removeOption} ${t.rule(index + 1)}`}
              onClick={() => onChange({ rules: data.rules.filter((item) => item.id !== rule.id) })}
            />
          </Stack>
          <TextField
            select
            size="small"
            label={t.source}
            value={rule.source}
            onChange={(event) =>
              setRule(rule.id, { source: event.target.value as 'message' | 'variable' })
            }
          >
            {(Object.keys(t.sources) as (keyof typeof t.sources)[]).map((key) => (
              <MenuItem key={key} value={key}>
                {t.sources[key]}
              </MenuItem>
            ))}
          </TextField>
          {rule.source === 'variable' && (
            <TextField
              size="small"
              label={t.variable}
              value={rule.variable}
              onChange={(event) =>
                setRule(rule.id, {
                  variable: event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 31),
                })
              }
            />
          )}
          <TextField
            select
            size="small"
            label={t.operator}
            value={rule.operator}
            onChange={(event) =>
              setRule(rule.id, {
                operator: event.target.value as NodeData['condition']['rules'][number]['operator'],
              })
            }
          >
            {(Object.keys(t.operators) as (keyof typeof t.operators)[]).map((key) => (
              <MenuItem key={key} value={key}>
                {t.operators[key]}
              </MenuItem>
            ))}
          </TextField>
          {['equals', 'contains', 'starts_with'].includes(rule.operator) && (
            <TextField
              size="small"
              label={t.value}
              value={rule.value}
              onChange={(event) => setRule(rule.id, { value: event.target.value.slice(0, 200) })}
            />
          )}
        </Stack>
      ))}
      {data.rules.length < 10 && (
        <Box>
          <Button
            size="small"
            startIcon={<AddRounded />}
            onClick={() =>
              onChange({
                rules: [
                  ...data.rules,
                  {
                    id: newId('c'),
                    source: 'message',
                    variable: '',
                    operator: 'contains',
                    value: '',
                  },
                ],
              })
            }
          >
            {t.addRule}
          </Button>
        </Box>
      )}
    </Section>
  )
}
