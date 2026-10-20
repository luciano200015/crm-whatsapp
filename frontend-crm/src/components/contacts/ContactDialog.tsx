import { zodResolver } from '@hookform/resolvers/zod'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormLabel from '@mui/material/FormLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Contact, ContactRequest, Tag } from '../../lib/api/types'
import { FormTextField } from '../form/FormTextField'
import { TagChip } from './TagChip'

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
})
type ContactValues = z.infer<typeof contactSchema>

/** Create or edit a contact. The API normalizes the phone to E.164. */
export function ContactDialog({
  contact,
  tags,
  onClose,
  onSubmit,
}: {
  contact: Contact | null
  tags: Tag[]
  onClose: () => void
  onSubmit: (values: ContactRequest) => Promise<void>
}) {
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
    },
  })

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      await onSubmit({
        name: values.name || null,
        phone: values.phone,
        email: values.email || null,
        notes: values.notes || null,
        tagIds: values.tagIds,
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {contact ? es.contacts.form.editTitle : es.contacts.form.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormTextField
              control={control}
              name="phone"
              type="tel"
              label={es.contacts.form.phone}
              placeholder={es.contacts.form.phonePlaceholder}
              helperText={es.contacts.form.phoneHelp}
              autoFocus={!contact}
              required
              fullWidth
            />
            <FormTextField
              control={control}
              name="name"
              label={es.contacts.form.name}
              placeholder={es.contacts.form.namePlaceholder}
              fullWidth
            />
            <FormTextField
              control={control}
              name="email"
              type="email"
              label={es.contacts.form.email}
              placeholder={es.contacts.form.emailPlaceholder}
              fullWidth
            />
            <Controller
              name="tagIds"
              control={control}
              render={({ field }) => (
                <Box>
                  <FormLabel
                    id={tagsLabelId}
                    sx={{ display: 'block', mb: 0.75, fontSize: 13, fontWeight: 600 }}
                  >
                    {es.contacts.form.tags}
                  </FormLabel>
                  <Autocomplete
                    multiple
                    options={tags}
                    value={tags.filter((tag) => field.value.includes(tag.id))}
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
              )}
            />
            <FormTextField
              control={control}
              name="notes"
              label={es.contacts.form.notes}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {es.contacts.form.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
