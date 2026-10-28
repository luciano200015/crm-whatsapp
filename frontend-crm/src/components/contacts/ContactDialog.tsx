import { zodResolver } from '@hookform/resolvers/zod'
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import HeadsetMicOutlined from '@mui/icons-material/HeadsetMicOutlined'
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormLabel from '@mui/material/FormLabel'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { contactKeys, contactsApi, type ContactField } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import type { Contact, ContactRequest } from '../../lib/api/types'
import { FormTextField } from '../form/FormTextField'
import { TagChip } from './TagChip'
import { useContactFields, useTags } from './useContacts'

const t = es.contacts.form

const contactSchema = z.object({
  name: z.string().trim().max(120, es.validation.maxLength(120)),
  phone: z
    .string()
    .trim()
    .min(1, es.common.required)
    .regex(/^\+?[\d\s()-]{6,32}$/, es.apiErrors.INVALID_PHONE),
  email: z.union([z.literal(''), z.email(es.validation.email)]),
  notes: z.string().max(2000, es.validation.maxLength(2000)),
  tagIds: z.array(z.string()),
  fields: z.record(z.string(), z.string()),
})
type ContactValues = z.infer<typeof contactSchema>

type TabId = 'details' | 'agents'

/**
 * «Editar contacto», like wasapi: «Detalles de contacto» (data, tags and
 * custom fields) and «Asignación de asesores» (regular agent per line).
 * Saves itself; onSaved runs after a successful save.
 */
export function ContactDialog({
  workspaceId,
  contact,
  onClose,
  onSaved,
}: {
  workspaceId: string
  contact: Contact | null
  onClose: () => void
  onSaved?: (contact: Contact, created: boolean) => void
}) {
  const client = useQueryClient()
  const tags = useTags()
  const fields = useContactFields(workspaceId)
  const [tab, setTab] = useState<TabId>('details')
  const [error, setError] = useState<string | null>(null)
  const tagsLabelId = useId()
  const { control, handleSubmit, formState } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: contact?.name ?? '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
      notes: contact?.notes ?? '',
      tagIds: contact?.tags.map((tag) => tag.id) ?? [],
      fields: Object.fromEntries(
        Object.entries(contact?.fields ?? {}).map(([key, value]) => [key, String(value)]),
      ),
    },
  })

  const assignments = useQuery({
    queryKey: contactKeys.agents(workspaceId, contact?.id ?? ''),
    queryFn: () => contactsApi.agents(workspaceId, contact?.id ?? ''),
    enabled: !!contact,
  })
  // Lines whose regular agent changed in this dialog (null removes it).
  const [agents, setAgents] = useState<Record<string, string | null>>({})

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      const body: ContactRequest = {
        name: values.name || null,
        phone: values.phone,
        email: values.email || null,
        notes: values.notes || null,
        tagIds: values.tagIds,
        fields: fieldValues(fields.data ?? [], values.fields, contact),
      }
      let saved = contact
        ? await contactsApi.update(workspaceId, contact.id, body)
        : await contactsApi.create(workspaceId, body)
      const changed = Object.entries(agents).map(([lineId, membershipId]) => ({
        lineId,
        membershipId,
      }))
      if (contact && changed.length > 0) {
        saved = await contactsApi.setAgents(workspaceId, contact.id, changed)
        void client.invalidateQueries({ queryKey: contactKeys.agents(workspaceId, contact.id) })
      }
      onSaved?.(saved, !contact)
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
          {contact ? t.editTitle : t.createTitle}
          <IconButton
            aria-label={es.common.close}
            onClick={onClose}
            disabled={formState.isSubmitting}
            sx={{ position: 'absolute', right: 12, top: 12 }}
          >
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <Tabs
          value={tab}
          onChange={(_, value: TabId) => setTab(value)}
          variant="fullWidth"
          aria-label={t.tabs}
          sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            value="details"
            icon={<AssignmentOutlined />}
            label={t.detailsTab}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          />
          <Tab
            value="agents"
            icon={<HeadsetMicOutlined />}
            label={t.agentsTab}
            disabled={!contact}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          />
        </Tabs>
        <DialogContent sx={{ minHeight: 320 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2.5} sx={{ pt: 1, display: tab === 'details' ? 'flex' : 'none' }}>
            {!contact && (
              <Typography variant="body2" color="text.secondary">
                {t.agentsAfterCreate}
              </Typography>
            )}
            <FormTextField
              control={control}
              name="phone"
              type="tel"
              label={t.phone}
              placeholder={t.phonePlaceholder}
              helperText={t.phoneHelp}
              autoFocus={!contact}
              required
              fullWidth
            />
            <FormTextField
              control={control}
              name="name"
              label={t.name}
              placeholder={t.namePlaceholder}
              fullWidth
            />
            <FormTextField
              control={control}
              name="email"
              type="email"
              label={t.email}
              placeholder={t.emailPlaceholder}
              fullWidth
            />
            <Controller
              name="tagIds"
              control={control}
              render={({ field }) => {
                const options = tags.data ?? []
                return (
                  <Box>
                    <FormLabel
                      id={tagsLabelId}
                      sx={{ display: 'block', mb: 0.75, fontSize: 13, fontWeight: 600 }}
                    >
                      {t.tags}
                    </FormLabel>
                    <Autocomplete
                      multiple
                      options={options}
                      value={options.filter((tag) => field.value.includes(tag.id))}
                      onChange={(_, selected) => field.onChange(selected.map((tag) => tag.id))}
                      getOptionLabel={(tag) => tag.name}
                      isOptionEqualToValue={(a, b) => a.id === b.id}
                      renderValue={(selected, getItemProps) =>
                        selected.map((tag, index) => {
                          const { key, ...itemProps } = getItemProps({ index })
                          return <TagChip key={key} tag={tag} {...itemProps} />
                        })
                      }
                      renderOption={(props, tag) => {
                        const { key, ...optionProps } = props
                        return (
                          <li key={key} {...optionProps}>
                            <TagChip tag={tag} />
                          </li>
                        )
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          slotProps={{
                            ...params.slotProps,
                            htmlInput: {
                              ...params.slotProps.htmlInput,
                              'aria-labelledby': tagsLabelId,
                            },
                          }}
                        />
                      )}
                    />
                  </Box>
                )
              }}
            />
            <FormTextField
              control={control}
              name="notes"
              label={t.notes}
              multiline
              minRows={2}
              fullWidth
            />
            {!!fields.data?.length && (
              <>
                <Divider textAlign="left">
                  <Typography variant="caption" color="text.secondary">
                    {t.customFields}
                  </Typography>
                </Divider>
                {fields.data.map((definition) => (
                  <Controller
                    key={definition.id}
                    name={`fields.${definition.key}`}
                    control={control}
                    render={({ field }) => (
                      <FieldInput
                        definition={definition}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                      />
                    )}
                  />
                ))}
              </>
            )}
          </Stack>
          {tab === 'agents' && contact && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t.agentsIntro}
              </Typography>
              {assignments.isPending ? (
                <Skeleton variant="rounded" height={96} />
              ) : assignments.isError ? (
                <Alert severity="error">{errorMessage(assignments.error)}</Alert>
              ) : assignments.data.length === 0 ? (
                <Alert severity="info">{t.noLines}</Alert>
              ) : (
                assignments.data.map((line) => {
                  const value =
                    line.lineId in agents
                      ? (agents[line.lineId] ?? '')
                      : (line.agentMembershipId ?? '')
                  return (
                    <Paper
                      key={line.lineId}
                      variant="outlined"
                      sx={{
                        p: 2,
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        gap: 2,
                        alignItems: { sm: 'center' },
                      }}
                    >
                      <Box sx={{ minWidth: 140, flexShrink: 0 }}>
                        <Typography sx={{ fontWeight: 700 }}>{line.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {line.displayPhone ?? '—'}
                        </Typography>
                      </Box>
                      <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ display: { xs: 'none', sm: 'block' } }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          label={t.regularAgent}
                          value={value}
                          onChange={(event) =>
                            setAgents((current) => ({
                              ...current,
                              [line.lineId]: event.target.value || null,
                            }))
                          }
                          slotProps={{
                            htmlInput: { 'aria-label': `${t.regularAgent} · ${line.name}` },
                          }}
                        >
                          <MenuItem value="">
                            <em>{t.noRegularAgent}</em>
                          </MenuItem>
                          {line.agents.map((agent) => (
                            <MenuItem key={agent.membershipId} value={agent.membershipId}>
                              {agent.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        {line.attending && (
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ alignItems: 'center', mt: 0.75, color: 'text.secondary' }}
                          >
                            <SwapHorizRounded sx={{ fontSize: 16 }} />
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {t.attending(line.attending.name)}
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </Paper>
                  )
                })
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, borderTop: 1, borderColor: 'divider', pt: 2 }}>
          <Button variant="outlined" onClick={onClose} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="success"
            disabled={formState.isSubmitting}
          >
            {t.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

/** One custom field, by its type. */
function FieldInput({
  definition,
  value,
  onChange,
}: {
  definition: ContactField
  value: string
  onChange: (value: string) => void
}) {
  if (definition.type === 'SELECT') {
    return (
      <TextField
        select
        fullWidth
        label={definition.label}
        value={definition.options.includes(value) ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">
          <em>—</em>
        </MenuItem>
        {definition.options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    )
  }
  return (
    <TextField
      fullWidth
      label={definition.label}
      type={definition.type === 'NUMBER' ? 'number' : definition.type === 'DATE' ? 'date' : 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        inputLabel: definition.type === 'DATE' ? { shrink: true } : undefined,
        htmlInput: definition.type === 'TEXT' ? { maxLength: 500 } : undefined,
      }}
    />
  )
}

/** What changed in the custom fields: '' clears a value, numbers go as numbers. */
function fieldValues(
  definitions: ContactField[],
  values: Record<string, string>,
  contact: Contact | null,
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {}
  for (const definition of definitions) {
    const raw = (values[definition.key] ?? '').trim()
    const before = contact?.fields?.[definition.key]
    if (raw === '') {
      if (before !== undefined) result[definition.key] = null
      continue
    }
    const value = definition.type === 'NUMBER' ? Number(raw) : raw
    if (value !== before) result[definition.key] = value
  }
  return result
}
