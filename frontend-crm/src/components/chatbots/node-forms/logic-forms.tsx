import EditOutlined from '@mui/icons-material/EditOutlined'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
} from '@mui/material'
import { useState } from 'react'
import { es } from '../../../i18n/es'
import type { ConditionMatch, ConditionRule, NodeData, Operator } from '../../../lib/api/chatbots'
import { fieldVariable, useFlowEditor } from '../flow-editor-context'
import { LIMITS, newId, ruleText, VALUE_OPERATORS } from '../flow-model'
import { ScheduleEditor } from '../ScheduleEditor'
import { AddButton, RemoveButton, Section, TextWithTools } from './fields'

const t = es.chatbots.node

/** The rule's subject in the «Variable» select: the last message or a variable. */
const MESSAGE = '@message'

/** «Nueva condición»: Variable, Operador and Valor de comparación, as in wasapi. */
function RuleDialog({
  rule,
  onClose,
  onSave,
}: {
  rule: ConditionRule
  onClose: () => void
  onSave: (rule: ConditionRule) => void
}) {
  const { variables, contactVariables, contactFields } = useFlowEditor()
  const [draft, setDraft] = useState(rule)
  const subject = draft.source === 'message' ? MESSAGE : draft.variable
  const known =
    subject === MESSAGE ||
    variables.some((variable) => variable.name === subject) ||
    contactVariables.includes(subject) ||
    contactFields.some((field) => fieldVariable(field.key) === subject)
  const needsValue = VALUE_OPERATORS.includes(draft.operator)
  const ready = !!subject && (!needsValue || draft.value.trim() !== '')
  const isNew = !rule.variable && rule.source === 'variable'
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose} aria-labelledby="rule-title">
      <DialogTitle id="rule-title">{isNew ? t.newRule : t.editRule}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label={t.ruleVariable}
            value={subject}
            required
            onChange={(event) =>
              setDraft((before) =>
                event.target.value === MESSAGE
                  ? { ...before, source: 'message', variable: '' }
                  : { ...before, source: 'variable', variable: event.target.value },
              )
            }
          >
            <MenuItem value={MESSAGE}>{t.lastMessage}</MenuItem>
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
            {contactFields.map((field) => (
              <MenuItem key={field.key} value={fieldVariable(field.key)}>
                {field.label}
              </MenuItem>
            ))}
            {subject && !known && <MenuItem value={subject}>{t.variableMissing(subject)}</MenuItem>}
          </TextField>
          <TextField
            select
            size="small"
            label={t.operator}
            value={draft.operator}
            onChange={(event) =>
              setDraft((before) => ({ ...before, operator: event.target.value as Operator }))
            }
          >
            {(Object.keys(t.operators) as Operator[]).map((key) => (
              <MenuItem key={key} value={key}>
                {t.operators[key]}
              </MenuItem>
            ))}
          </TextField>
          {needsValue && (
            <TextWithTools
              label={t.value}
              value={draft.value}
              max={LIMITS.ruleValue}
              required
              helperText={
                draft.operator === 'in' || draft.operator === 'not_in' ? t.listValueHelp : undefined
              }
              onValue={(value) => setDraft((before) => ({ ...before, value }))}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{es.chatbots.editor.close}</Button>
        <Button
          variant="contained"
          color="success"
          disabled={!ready}
          onClick={() => onSave({ ...draft, value: needsValue ? draft.value.trim() : '' })}
        >
          {es.chatbots.editor.update}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** «Condiciones»: the list of conditions and «Cumplimiento de condiciones». */
export function ConditionForm({
  data,
  onChange,
}: {
  data: NodeData['condition']
  onChange: (changes: Partial<NodeData['condition']>) => void
}) {
  const [editing, setEditing] = useState<ConditionRule | null>(null)
  const save = (rule: ConditionRule) => {
    const exists = data.rules.some((item) => item.id === rule.id)
    onChange({
      rules: exists
        ? data.rules.map((item) => (item.id === rule.id ? rule : item))
        : [...data.rules, rule],
    })
    setEditing(null)
  }
  return (
    <>
      <Section title={t.rules}>
        {data.rules.length === 0 && (
          <Typography variant="body2" color="warning.main">
            {t.noRules}
          </Typography>
        )}
        {data.rules.map((rule, index) => (
          <Stack
            key={rule.id}
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              px: 1.25,
              py: 0.75,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {t.rule(index + 1)}
              </Typography>
              <Typography variant="body2">{ruleText(rule)}</Typography>
            </Box>
            <IconButton
              size="small"
              aria-label={`${t.editRule} ${index + 1}`}
              onClick={() => setEditing(rule)}
            >
              <EditOutlined fontSize="small" />
            </IconButton>
            <RemoveButton
              label={`${t.removeOption} ${t.rule(index + 1)}`}
              onClick={() => onChange({ rules: data.rules.filter((item) => item.id !== rule.id) })}
            />
          </Stack>
        ))}
        {data.rules.length < LIMITS.rules && (
          <AddButton
            label={t.addRule}
            onClick={() =>
              setEditing({
                id: newId('c'),
                source: 'variable',
                variable: '',
                operator: 'equals',
                value: '',
              })
            }
          />
        )}
      </Section>
      <FormControl>
        <FormLabel sx={{ fontWeight: 700, color: 'text.primary', fontSize: 14 }}>
          {t.match}
        </FormLabel>
        <RadioGroup
          value={data.match}
          onChange={(event) => onChange({ match: event.target.value as ConditionMatch })}
        >
          {(Object.keys(t.matches) as ConditionMatch[]).map((key) => (
            <FormControlLabel
              key={key}
              value={key}
              control={<Radio size="small" />}
              label={t.matches[key]}
            />
          ))}
        </RadioGroup>
      </FormControl>
      {editing && <RuleDialog rule={editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  )
}

/** «Horario de atención»: days and hours in a time zone. */
export function HoursForm({
  data,
  onChange,
}: {
  data: NodeData['hours']
  onChange: (changes: Partial<NodeData['hours']>) => void
}) {
  return <ScheduleEditor value={data.schedule} onChange={(schedule) => onChange({ schedule })} />
}
