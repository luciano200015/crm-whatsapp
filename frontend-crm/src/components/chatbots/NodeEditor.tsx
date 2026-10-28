import AddRounded from '@mui/icons-material/AddRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  type TextFieldProps,
} from '@mui/material'
import { useRef, type ReactNode } from 'react'
import { es } from '../../i18n/es'
import type { BotPause, NodeData, NodeKind, Operator, Validation } from '../../lib/api/chatbots'
import type { FunnelSummary } from '../../lib/api/funnels'
import type { TagSummary } from '../../lib/api/types'
import { useFunnel, useFunnelList } from '../funnels/useFunnels'
import { AttachmentsField } from './AttachmentsField'
import { useFlowEditor } from './flow-editor-context'
import { LIMITS, newId, titleOf, triggerOf, type EditorNode } from './flow-model'
import { NodeIcon } from './node-icons'
import { ScheduleEditor } from './ScheduleEditor'
import { VariableButton } from './VariableButton'

const t = es.chatbots.node

/**
 * A text field that shows how much of WhatsApp's limit is used. With
 * `variables`, "Agregar variable" puts {{name}} where the cursor is.
 */
function LimitedField({
  value,
  max,
  onValue,
  variables = false,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  max: number
  onValue: (value: string) => void
  variables?: boolean
}) {
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const field = (
    <TextField
      size="small"
      fullWidth
      {...props}
      inputRef={input}
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
  if (!variables) return field
  const insert = (token: string) => {
    const at = input.current?.selectionStart ?? value.length
    const end = input.current?.selectionEnd ?? at
    onValue((value.slice(0, at) + token + value.slice(end)).slice(0, max))
  }
  return (
    <Stack spacing={0.5}>
      {field}
      <VariableButton onInsert={insert} />
    </Stack>
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
        label={t.botReply}
        value={data.body}
        max={LIMITS.body}
        multiline
        minRows={3}
        required
        error={!data.body.trim()}
        helperText={t.variables}
        variables
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

/** "Enviar mensaje y saltar al siguiente nodo", or wait for an answer. */
function JumpField({
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

/** "Respuesta si elige otra cosa": required on buttons and lists. */
function InvalidText({ value, onValue }: { value: string; onValue: (value: string) => void }) {
  const missing = !value.trim()
  return (
    <Section title={t.invalidText}>
      <LimitedField
        label={t.invalidText}
        placeholder={t.invalidDefault}
        value={value}
        max={LIMITS.invalidText}
        required
        error={missing}
        helperText={missing ? t.invalidRequired : t.invalidHelp}
        variables
        onValue={onValue}
      />
    </Section>
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
  triggerLocked,
  tags,
  members,
  onChange,
  onDelete,
  onClose,
}: {
  workspaceId: string
  chatbotId: string
  node: EditorNode
  /** Something that moves on by itself (buttons, a list…) connects to it. */
  triggerLocked: boolean
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
            {titleOf(node.data) || es.chatbots.nodes[kind].label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {es.chatbots.nodes[kind].label}
          </Typography>
        </Box>
        <IconButton aria-label={es.chatbots.editor.close} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>
      <Stack spacing={2} sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        <LimitedField
          label={t.title}
          value={titleOf(node.data)}
          max={LIMITS.title}
          placeholder={es.chatbots.nodes[kind].label}
          helperText={t.titleHelp}
          onValue={(title) => onChange({ ...node.data, title })}
        />
        {kind !== 'start' && (
          <Stack spacing={1}>
            <LimitedField
              label={t.trigger}
              value={triggerLocked ? '' : triggerOf(node.data)}
              max={LIMITS.trigger}
              disabled={triggerLocked}
              placeholder={t.triggerPlaceholder}
              helperText={t.triggerHelp}
              onValue={(trigger) => onChange({ ...node.data, trigger })}
            />
            {triggerLocked && <Alert severity="info">{t.triggerLocked}</Alert>}
          </Stack>
        )}
        <Alert severity="info" icon={false} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
          <AlertTitle sx={{ fontSize: 14 }}>{t.howItWorks}</AlertTitle>
          <Typography variant="body2">{es.chatbots.nodes[kind].guide}</Typography>
        </Alert>
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
      return null
    case 'message':
      return (
        <>
          <MessageForm
            workspaceId={workspaceId}
            chatbotId={chatbotId}
            data={data as NodeData['message']}
            onChange={onChange}
          />
          <JumpField wait={(data as NodeData['message']).wait === true} onChange={onChange} />
        </>
      )
    case 'buttons': {
      const value = data as NodeData['buttons']
      return (
        <>
          <InteractiveTexts data={value} onChange={onChange} />
          <Section title={t.attach}>
            <AttachmentsField
              workspaceId={workspaceId}
              chatbotId={chatbotId}
              value={value.attachments ?? []}
              help={t.attachBefore}
              onChange={(attachments) => onChange({ attachments })}
            />
          </Section>
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
      return (
        <ListForm
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          data={data as NodeData['list']}
          onChange={onChange}
        />
      )
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
          <JumpField wait={value.wait === true} onChange={onChange} />
        </>
      )
    }
    case 'question':
      return <QuestionForm data={data as NodeData['question']} onChange={onChange} />
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
    case 'transfer':
      return (
        <TransferForm data={data as NodeData['transfer']} members={members} onChange={onChange} />
      )
    case 'funnel':
      return <FunnelForm data={data as NodeData['funnel']} onChange={onChange} />
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

/** "Guardar respuesta": the question, where the answer goes and how it is checked. */
function QuestionForm({
  data: value,
  onChange,
}: {
  data: NodeData['question']
  onChange: (changes: Partial<NodeData['question']>) => void
}) {
  const { variables, onOpenVariables } = useFlowEditor()
  const known = variables.some(
    (variable) => variable.name.toLowerCase() === value.variable.toLowerCase(),
  )
  return (
    <>
      <LimitedField
        label={t.question}
        value={value.text}
        max={LIMITS.text}
        multiline
        minRows={2}
        required
        error={!value.text.trim()}
        helperText={t.variables}
        variables
        onValue={(text) => onChange({ text })}
      />
      {variables.length === 0 && !value.variable ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={onOpenVariables}>
              {t.createVariable}
            </Button>
          }
        >
          {t.noVariables}
        </Alert>
      ) : (
        <Stack spacing={0.5}>
          <TextField
            select
            size="small"
            label={t.variable}
            value={value.variable}
            required
            error={!value.variable || !known}
            helperText={t.variableHelp}
            onChange={(event) => onChange({ variable: event.target.value })}
          >
            {variables.map((variable) => (
              <MenuItem key={variable.name} value={variable.name}>
                {variable.name}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {es.chatbots.variables.types[variable.type]}
                </Typography>
              </MenuItem>
            ))}
            {value.variable && !known && (
              <MenuItem value={value.variable}>{t.variableMissing(value.variable)}</MenuItem>
            )}
          </TextField>
          <Box>
            <Button size="small" startIcon={<AddRounded />} onClick={onOpenVariables}>
              {t.createVariable}
            </Button>
          </Box>
        </Stack>
      )}
      <TextField
        select
        size="small"
        label={t.validation}
        value={value.validation}
        onChange={(event) => onChange({ validation: event.target.value as Validation })}
      >
        {(Object.keys(t.validations) as (keyof typeof t.validations)[]).map((key) => (
          <MenuItem key={key} value={key}>
            {t.validations[key]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t.saveTo}
        value={value.saveTo ?? 'none'}
        onChange={(event) =>
          onChange({ saveTo: event.target.value as NodeData['question']['saveTo'] })
        }
      >
        {(Object.keys(t.saveToOptions) as (keyof typeof t.saveToOptions)[]).map((key) => (
          <MenuItem key={key} value={key}>
            {t.saveToOptions[key]}
          </MenuItem>
        ))}
      </TextField>
      <LimitedField
        label={t.questionInvalid}
        value={value.invalidText}
        max={LIMITS.invalidText}
        helperText={t.questionInvalidHelp}
        variables
        onValue={(invalidText) => onChange({ invalidText })}
      />
    </>
  )
}

/** "Transferir conversación": to whom, what the customer is told and how long the bot stays off. */
/** «Establecer contacto en embudo»: the funnels of the bot's lines first. */
function FunnelForm({
  data,
  onChange,
}: {
  data: NodeData['funnel']
  onChange: (changes: Record<string, unknown>) => void
}) {
  const { lineIds } = useFlowEditor()
  const funnels = useFunnelList()
  const funnel = useFunnel(data.funnelId)
  if (funnels.isError) return <Alert severity="warning">{t.funnelsUnavailable}</Alert>
  const list = funnels.data ?? []
  if (funnels.isSuccess && list.length === 0) return <Alert severity="info">{t.noFunnels}</Alert>
  const own = list.filter((item) => lineIds.includes(item.lineId))
  const others = list.filter((item) => !lineIds.includes(item.lineId))
  const chosen = list.find((item) => item.id === data.funnelId)
  const stages = funnel.data?.stages ?? []
  const option = (item: FunnelSummary) => (
    <MenuItem key={item.id} value={item.id}>
      {item.name} · {item.lineName}
    </MenuItem>
  )
  return (
    <>
      <TextField
        select
        size="small"
        label={t.funnel}
        value={chosen ? chosen.id : ''}
        onChange={(event) => onChange({ funnelId: event.target.value, stageId: '' })}
      >
        {own.map(option)}
        {own.length > 0 && others.length > 0 && <ListSubheader>{t.funnelOtherLine}</ListSubheader>}
        {others.map(option)}
      </TextField>
      {chosen && lineIds.length > 0 && !lineIds.includes(chosen.lineId) && (
        <Alert severity="warning">{t.funnelOtherLineWarning}</Alert>
      )}
      <TextField
        select
        size="small"
        label={t.funnelStage}
        disabled={!chosen}
        value={stages.some((stage) => stage.id === data.stageId) ? data.stageId : ''}
        onChange={(event) => onChange({ stageId: event.target.value })}
      >
        {stages.map((stage) => (
          <MenuItem key={stage.id} value={stage.id}>
            {stage.name}
          </MenuItem>
        ))}
      </TextField>
    </>
  )
}

function TransferForm({
  data: value,
  members,
  onChange,
}: {
  data: NodeData['transfer']
  members: Member[]
  onChange: (changes: Partial<NodeData['transfer']>) => void
}) {
  return (
    <>
      <FormControl>
        <FormLabel>{t.transferTo}</FormLabel>
        <RadioGroup
          value={value.to}
          onChange={(event) =>
            onChange({
              to: event.target.value as NodeData['transfer']['to'],
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
        variables
        onValue={(message) => onChange({ message })}
      />
      <FormControl>
        <FormLabel>{t.pause}</FormLabel>
        <RadioGroup
          value={value.pause ?? '24h'}
          onChange={(event) => onChange({ pause: event.target.value as BotPause })}
        >
          {(Object.keys(t.pauseOptions) as BotPause[]).map((key) => (
            <FormControlLabel
              key={key}
              value={key}
              control={<Radio size="small" />}
              label={t.pauseOptions[key]}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </>
  )
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
  const attachments = data.attachments ?? []
  return (
    <>
      <LimitedField
        label={t.botReply}
        value={data.text}
        max={LIMITS.text}
        multiline
        minRows={4}
        error={!data.text.trim() && attachments.length === 0}
        helperText={t.variables}
        variables
        onValue={(text) => onChange({ text })}
      />
      <Section title={t.attach}>
        <AttachmentsField
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          value={attachments}
          help={t.attachHelp}
          onChange={(next) => onChange({ attachments: next })}
        />
      </Section>
    </>
  )
}

function ListForm({
  workspaceId,
  chatbotId,
  data,
  onChange,
}: {
  workspaceId: string
  chatbotId: string
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
      <Section title={t.attach}>
        <AttachmentsField
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          value={data.attachments ?? []}
          help={t.attachBefore}
          onChange={(attachments) => onChange({ attachments })}
        />
      </Section>
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
              required={data.sections.length > 1}
              helperText={data.sections.length > 1 ? t.sectionTitleMany : t.sectionTitleOne}
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

/** Operators that compare with a value. */
const WITH_VALUE: Operator[] = ['equals', 'contains', 'starts_with', 'greater_than', 'less_than']

function ConditionForm({
  data,
  onChange,
}: {
  data: NodeData['condition']
  onChange: (changes: Partial<NodeData['condition']>) => void
}) {
  const { variables, contactVariables } = useFlowEditor()
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
              select
              size="small"
              label={t.variablePick}
              value={rule.variable}
              error={!rule.variable}
              onChange={(event) => setRule(rule.id, { variable: event.target.value })}
            >
              <ListSubheader>{es.chatbots.variables.mine}</ListSubheader>
              {variables.map((variable) => (
                <MenuItem key={variable.name} value={variable.name}>
                  {variable.name}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {es.chatbots.variables.types[variable.type]}
                  </Typography>
                </MenuItem>
              ))}
              <ListSubheader>{es.chatbots.variables.contact}</ListSubheader>
              {contactVariables.map((name) => (
                <MenuItem key={name} value={name}>
                  {es.chatbots.variables.contactLabels[name] ?? name}
                </MenuItem>
              ))}
              {rule.variable &&
                !variables.some((variable) => variable.name === rule.variable) &&
                !contactVariables.includes(rule.variable) && (
                  <MenuItem value={rule.variable}>{t.variableMissing(rule.variable)}</MenuItem>
                )}
            </TextField>
          )}
          <TextField
            select
            size="small"
            label={t.operator}
            value={rule.operator}
            onChange={(event) => setRule(rule.id, { operator: event.target.value as Operator })}
          >
            {(Object.keys(t.operators) as Operator[]).map((key) => (
              <MenuItem key={key} value={key}>
                {t.operators[key]}
              </MenuItem>
            ))}
          </TextField>
          {WITH_VALUE.includes(rule.operator) && (
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
