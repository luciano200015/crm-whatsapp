import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import { Alert, Box, Button, Link, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { es } from '../../../i18n/es'
import type { FlowOption, NodeData, Validation } from '../../../lib/api/chatbots'
import { SendContactDialog } from '../../inbox/SendContactDialog'
import { ACCEPT_HEADER, AttachmentsField } from '../AttachmentsField'
import { useFlowEditor } from '../flow-editor-context'
import { LIMITS, newId, sentAsButtons } from '../flow-model'
import {
  AddButton,
  Advanced,
  JumpField,
  LimitedField,
  RemoveButton,
  Section,
  TextWithTools,
} from './fields'

const t = es.chatbots.node

interface Files {
  workspaceId: string
  chatbotId: string
}

/**
 * «Respuesta»: the bot's text, files and «Botones interactivos». Up to 3
 * short buttons go as buttons; more go as a list, which only needs the name
 * of its button: no sections, no descriptions unless wanted.
 */
export function MessageForm({
  workspaceId,
  chatbotId,
  data,
  onChange,
}: Files & {
  data: NodeData['message']
  onChange: (changes: Partial<NodeData['message']>) => void
}) {
  const options = data.options
  const asList = options.length > 0 && !sentAsButtons(options)
  const setOption = (id: string, changes: Partial<FlowOption>) =>
    onChange({
      options: options.map((option) => (option.id === id ? { ...option, ...changes } : option)),
    })
  const empty = !data.text.trim() && (options.length > 0 || data.attachments.length === 0)
  return (
    <>
      <TextWithTools
        label={t.botReply}
        value={data.text}
        max={options.length > 0 ? LIMITS.body : LIMITS.text}
        multiline
        minRows={3}
        error={empty}
        helperText={t.variables}
        onValue={(text) => onChange({ text })}
      />
      <Section title={t.attach}>
        <AttachmentsField
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          value={data.attachments}
          help={options.length > 0 ? t.attachWithButtons : t.attachHelp}
          onChange={(attachments) => onChange({ attachments })}
        />
      </Section>
      <Section title={t.options} help={t.optionsHelp}>
        {options.map((option, index) => (
          <Stack key={option.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <LimitedField
              label={t.button(index + 1)}
              value={option.title}
              max={LIMITS.optionTitle}
              error={!option.title.trim()}
              onValue={(title) => setOption(option.id, { title })}
            />
            <RemoveButton
              label={`${t.removeOption} ${t.button(index + 1)}`}
              onClick={() => onChange({ options: options.filter((item) => item.id !== option.id) })}
            />
          </Stack>
        ))}
        {options.length < LIMITS.options && (
          <AddButton
            label={t.addButton}
            onClick={() =>
              onChange({
                options: [...options, { id: newId('o'), title: `Opción ${options.length + 1}` }],
              })
            }
          />
        )}
        {asList && (
          <Stack spacing={1.25}>
            <Alert severity="info" icon={<FormatListBulletedRounded fontSize="small" />}>
              {t.asList}
            </Alert>
            <LimitedField
              label={t.listButton}
              placeholder={t.listButtonDefault}
              value={data.listButton}
              max={LIMITS.listButton}
              onValue={(listButton) => onChange({ listButton })}
            />
          </Stack>
        )}
      </Section>
      {options.length === 0 ? (
        <JumpField wait={data.wait === true} onChange={onChange} />
      ) : (
        <Advanced>
          <LimitedField
            label={t.header}
            value={data.header}
            max={LIMITS.header}
            onValue={(header) => onChange({ header })}
          />
          <LimitedField
            label={t.footer}
            value={data.footer}
            max={LIMITS.footer}
            onValue={(footer) => onChange({ footer })}
          />
          <Stack spacing={1.25}>
            <Typography variant="caption" color="text.secondary">
              {t.descriptionsHelp}
            </Typography>
            {options.map((option) => (
              <LimitedField
                key={option.id}
                label={t.description(option.title)}
                value={option.description ?? ''}
                max={LIMITS.optionDescription}
                onValue={(description) => setOption(option.id, { description })}
              />
            ))}
          </Stack>
          <TextWithTools
            label={t.invalidText}
            value={data.invalidText}
            max={LIMITS.invalidText}
            multiline
            minRows={2}
            helperText={t.invalidHelp}
            onValue={(invalidText) => onChange({ invalidText })}
          />
        </Advanced>
      )}
    </>
  )
}

/** «Botón de URL»: text, the button and its link, with an optional file above. */
export function UrlForm({
  workspaceId,
  chatbotId,
  data,
  onChange,
}: Files & {
  data: NodeData['url']
  onChange: (changes: Partial<NodeData['url']>) => void
}) {
  return (
    <>
      <TextWithTools
        label={t.botReply}
        value={data.body}
        max={LIMITS.body}
        multiline
        minRows={3}
        required
        error={!data.body.trim()}
        helperText={t.variables}
        onValue={(body) => onChange({ body })}
      />
      <LimitedField
        label={t.urlText}
        value={data.text}
        max={LIMITS.urlText}
        required
        error={!data.text.trim()}
        onValue={(text) => onChange({ text })}
      />
      <TextField
        size="small"
        label={t.url}
        value={data.url}
        required
        error={!/^https:\/\/\S+\.\S+/.test(data.url)}
        onChange={(event) => onChange({ url: event.target.value.trim().slice(0, 2000) })}
      />
      <Section title={t.headerFile}>
        <AttachmentsField
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          value={data.attachment ? [data.attachment] : []}
          help={t.headerFileHelp}
          max={1}
          accept={ACCEPT_HEADER}
          onChange={(files) => onChange({ attachment: files[0] ?? null })}
        />
      </Section>
      <JumpField wait={data.wait === true} onChange={onChange} />
      <Advanced>
        <LimitedField
          label={t.header}
          value={data.header}
          max={LIMITS.header}
          disabled={!!data.attachment}
          onValue={(header) => onChange({ header })}
        />
        <LimitedField
          label={t.footer}
          value={data.footer}
          max={LIMITS.footer}
          onValue={(footer) => onChange({ footer })}
        />
      </Advanced>
    </>
  )
}

/**
 * «Guardar respuesta»: like wasapi, a title and the variable. A question is
 * optional: without it the card saves the message that opened it.
 */
export function QuestionForm({
  data,
  trigger,
  onChange,
}: {
  data: NodeData['question']
  /** Its "Respuesta del usuario": without a question, it is what opens the card. */
  trigger: string
  onChange: (changes: Partial<NodeData['question']>) => void
}) {
  const { variables, onOpenVariables } = useFlowEditor()
  const known = variables.some(
    (variable) => variable.name.toLowerCase() === data.variable.toLowerCase(),
  )
  const missing = !data.text.trim() && !trigger.trim()
  return (
    <>
      <TextWithTools
        label={t.question}
        value={data.text}
        max={LIMITS.text}
        multiline
        minRows={2}
        error={missing}
        helperText={missing ? t.questionNeeded : t.questionHelp}
        onValue={(text) => onChange({ text })}
      />
      {variables.length === 0 && !data.variable ? (
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
            value={data.variable}
            required
            error={!data.variable || !known}
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
            {data.variable && !known && (
              <MenuItem value={data.variable}>{t.variableMissing(data.variable)}</MenuItem>
            )}
          </TextField>
          <AddButton label={t.createVariable} onClick={onOpenVariables} />
        </Stack>
      )}
      <Advanced>
        <TextField
          select
          size="small"
          label={t.validation}
          value={data.validation}
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
          value={data.saveTo ?? 'none'}
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
        <TextWithTools
          label={t.questionInvalid}
          value={data.invalidText}
          max={LIMITS.invalidText}
          helperText={t.questionInvalidHelp}
          onValue={(invalidText) => onChange({ invalidText })}
        />
      </Advanced>
    </>
  )
}

/** A coordinate typed as text: «-16.5» passes through «-» and «-16.». */
function CoordinateField({
  label,
  value,
  limit,
  onValue,
}: {
  label: string
  value: number | null
  limit: number
  onValue: (value: number | null) => void
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const number = Number(text.replace(',', '.'))
  const invalid = text.trim() === '' || !Number.isFinite(number) || Math.abs(number) > limit
  return (
    <TextField
      size="small"
      fullWidth
      required
      label={label}
      value={text}
      error={invalid}
      slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 20 } }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const parsed = Number(next.replace(',', '.'))
        onValue(next.trim() !== '' && Number.isFinite(parsed) ? parsed : null)
      }}
    />
  )
}

/** «Enviar ubicación»: a point on the map. */
export function LocationForm({
  data,
  onChange,
}: {
  data: NodeData['location']
  onChange: (changes: Partial<NodeData['location']>) => void
}) {
  const ready = data.latitude !== null && data.longitude !== null
  return (
    <>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1}>
          <CoordinateField
            label={t.latitude}
            value={data.latitude}
            limit={90}
            onValue={(latitude) => onChange({ latitude })}
          />
          <CoordinateField
            label={t.longitude}
            value={data.longitude}
            limit={180}
            onValue={(longitude) => onChange({ longitude })}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t.coordinatesHelp}
        </Typography>
      </Stack>
      <LimitedField
        label={t.placeName}
        value={data.name}
        max={LIMITS.placeName}
        onValue={(name) => onChange({ name })}
      />
      <LimitedField
        label={t.placeAddress}
        value={data.address}
        max={LIMITS.placeName}
        onValue={(address) => onChange({ address })}
      />
      {ready && (
        <Box>
          <Link
            href={`https://www.google.com/maps?q=${data.latitude},${data.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            {t.seeMap}
            <OpenInNewRounded sx={{ fontSize: 16 }} />
          </Link>
        </Box>
      )}
    </>
  )
}

/** «Enviar contacto»: 1 to 5 cards, typed or picked from the CRM. */
export function ContactCardForm({
  data,
  onChange,
}: {
  data: NodeData['contact_card']
  onChange: (changes: Partial<NodeData['contact_card']>) => void
}) {
  const [picking, setPicking] = useState(false)
  const contacts = data.contacts
  const set = (index: number, changes: Partial<(typeof contacts)[number]>) =>
    onChange({
      contacts: contacts.map((contact, i) => (i === index ? { ...contact, ...changes } : contact)),
    })
  return (
    <Section title={t.contacts}>
      {contacts.map((contact, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Stack spacing={1} sx={{ flex: 1 }}>
            <LimitedField
              label={t.contactName}
              value={contact.name}
              max={LIMITS.contactName}
              required
              error={!contact.name.trim()}
              onValue={(name) => set(index, { name })}
            />
            <TextField
              size="small"
              label={t.contactPhone}
              value={contact.phone}
              required
              error={!/^\+?[\d\s()-]{6,24}$/.test(contact.phone)}
              helperText={t.contactPhoneHelp}
              onChange={(event) => set(index, { phone: event.target.value.slice(0, 24) })}
            />
          </Stack>
          {contacts.length > 1 && (
            <RemoveButton
              label={`${t.removeOption} ${contact.name || t.contactName}`}
              onClick={() => onChange({ contacts: contacts.filter((_, i) => i !== index) })}
            />
          )}
        </Stack>
      ))}
      <Stack direction="row" spacing={1}>
        {contacts.length < LIMITS.contactCards && (
          <AddButton
            label={t.addContact}
            onClick={() => onChange({ contacts: [...contacts, { name: '', phone: '' }] })}
          />
        )}
        <Button size="small" startIcon={<ContactsOutlined />} onClick={() => setPicking(true)}>
          {t.pickContacts}
        </Button>
      </Stack>
      {picking && (
        <SendContactDialog
          onClose={() => setPicking(false)}
          onSend={(picked) => {
            const typed = contacts.filter((contact) => contact.name.trim() || contact.phone.trim())
            onChange({ contacts: [...typed, ...picked].slice(0, LIMITS.contactCards) })
            setPicking(false)
          }}
        />
      )}
    </Section>
  )
}
