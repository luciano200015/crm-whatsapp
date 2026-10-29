import {
  Alert,
  Autocomplete,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../../i18n/es'
import type { BotPause, NodeData } from '../../../lib/api/chatbots'
import type { FunnelSummary } from '../../../lib/api/funnels'
import type { TagSummary } from '../../../lib/api/types'
import { useFunnel, useFunnelList } from '../../funnels/useFunnels'
import { useFlowEditor } from '../flow-editor-context'
import { LIMITS } from '../flow-model'
import { Advanced, TextWithTools } from './fields'

const t = es.chatbots.node

export interface Member {
  membershipId: string
  name: string
}

/** A set of options as radio buttons, labelled like wasapi's forms. */
function Choice<K extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: K
  options: Record<K, string>
  onChange: (value: K) => void
}) {
  return (
    <FormControl>
      <FormLabel sx={{ fontWeight: 700, color: 'text.primary', fontSize: 14 }}>{label}</FormLabel>
      <RadioGroup value={value} onChange={(event) => onChange(event.target.value as K)}>
        {(Object.keys(options) as K[]).map((key) => (
          <FormControlLabel
            key={key}
            value={key}
            control={<Radio size="small" />}
            label={options[key]}
          />
        ))}
      </RadioGroup>
    </FormControl>
  )
}

/**
 * «Gestionar etiquetas»: «Acción a realizar» (agregar o eliminar) and the
 * tags. A card saved with both lists shows both.
 */
export function TagsForm({
  data,
  tags,
  onChange,
}: {
  data: NodeData['tags']
  tags: TagSummary[]
  onChange: (changes: Partial<NodeData['tags']>) => void
}) {
  const both = data.add.length > 0 && data.remove.length > 0
  const [action, setAction] = useState<'add' | 'remove'>(
    data.remove.length > 0 && data.add.length === 0 ? 'remove' : 'add',
  )
  const pick = (key: 'add' | 'remove', label: string) => (
    <Autocomplete
      multiple
      size="small"
      options={tags}
      value={tags.filter((tag) => data[key].includes(tag.id))}
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
  if (both)
    return (
      <>
        {pick('add', t.addTags)}
        {pick('remove', t.removeTags)}
      </>
    )
  return (
    <>
      <Choice
        label={t.tagAction}
        value={action}
        options={t.tagActions}
        onChange={(next) => {
          setAction(next)
          // The chosen tags move to the other list.
          const chosen = [...data.add, ...data.remove]
          onChange(next === 'add' ? { add: chosen, remove: [] } : { add: [], remove: chosen })
        }}
      />
      {pick(action, t.tags)}
    </>
  )
}

/** «Transferir conversación»: what the customer is told, to whom, and a note for the agent. */
export function TransferForm({
  data,
  members,
  onChange,
}: {
  data: NodeData['transfer']
  members: Member[]
  onChange: (changes: Partial<NodeData['transfer']>) => void
}) {
  return (
    <>
      <TextWithTools
        label={t.transferMessage}
        value={data.message ?? t.transferMessageDefault}
        max={LIMITS.text}
        multiline
        minRows={2}
        helperText={t.transferMessageHelp}
        onValue={(message) => onChange({ message })}
      />
      <Choice
        label={t.transferTo}
        value={data.to}
        options={t.transferOptions}
        onChange={(to) =>
          onChange({ to, membershipId: to === 'member' ? data.membershipId : null })
        }
      />
      {data.to === 'member' && (
        <TextField
          select
          size="small"
          label={t.agent}
          value={data.membershipId ?? ''}
          required
          error={!data.membershipId}
          onChange={(event) => onChange({ membershipId: event.target.value || null })}
        >
          {members.map((member) => (
            <MenuItem key={member.membershipId} value={member.membershipId}>
              {member.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextWithTools
        label={t.transferNote}
        value={data.note ?? ''}
        max={LIMITS.text}
        multiline
        minRows={2}
        helperText={t.transferNoteHelp}
        onValue={(note) => onChange({ note })}
      />
      <Advanced>
        <Choice
          label={t.pause}
          value={data.pause ?? '24h'}
          options={t.pauseOptions as Record<BotPause, string>}
          onChange={(pause) => onChange({ pause })}
        />
      </Advanced>
    </>
  )
}

/** «Cambiar estado»: the chat's status and «Estado del bot». */
export function StatusForm({
  data,
  onChange,
}: {
  data: NodeData['status']
  onChange: (changes: Partial<NodeData['status']>) => void
}) {
  return (
    <>
      <TextField
        select
        size="small"
        label={t.statusLabel}
        value={data.status}
        onChange={(event) =>
          onChange({ status: event.target.value as NodeData['status']['status'] })
        }
      >
        {(Object.keys(t.statuses) as (keyof typeof t.statuses)[]).map((key) => (
          <MenuItem key={key} value={key}>
            {t.statuses[key]}
          </MenuItem>
        ))}
      </TextField>
      <Choice
        label={t.botState}
        value={data.bot ?? 'keep'}
        options={t.botStates}
        onChange={(bot) => onChange({ bot })}
      />
    </>
  )
}

/** «Actualizar campo de contacto»: the field, and where its value comes from. */
export function ContactFieldForm({
  data,
  onChange,
}: {
  data: NodeData['contact_field']
  onChange: (changes: Partial<NodeData['contact_field']>) => void
}) {
  const { contactFields } = useFlowEditor()
  const known = data.field in t.fieldNames || contactFields.some((f) => f.key === data.field)
  return (
    <>
      <TextField
        select
        size="small"
        label={t.field}
        value={data.field}
        required
        error={!data.field || !known}
        onChange={(event) => onChange({ field: event.target.value })}
      >
        {Object.entries(t.fieldNames).map(([key, label]) => (
          <MenuItem key={key} value={key}>
            {label}
          </MenuItem>
        ))}
        {contactFields.length > 0 && <ListSubheader>{t.customFields}</ListSubheader>}
        {contactFields.map((field) => (
          <MenuItem key={field.key} value={field.key}>
            {field.label}
          </MenuItem>
        ))}
        {data.field && !known && (
          <MenuItem value={data.field}>{t.fieldMissing(data.field)}</MenuItem>
        )}
      </TextField>
      <Choice
        label={t.fieldSource}
        value={data.source}
        options={t.fieldSources}
        onChange={(source) => onChange({ source })}
      />
      {data.source === 'manual' && (
        <TextWithTools
          label={t.fieldValue}
          value={data.value}
          max={LIMITS.text}
          required
          error={!data.value.trim()}
          helperText={t.variables}
          onValue={(value) => onChange({ value })}
        />
      )}
      <Alert severity="info">{t.fieldOutputs}</Alert>
    </>
  )
}

/** «Establecer contacto en embudo»: the funnels of the bot's lines first. */
export function FunnelForm({
  data,
  onChange,
}: {
  data: NodeData['funnel']
  onChange: (changes: Partial<NodeData['funnel']>) => void
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
