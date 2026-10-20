import { zodResolver } from '@hookform/resolvers/zod'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormLabel from '@mui/material/FormLabel'
import Stack from '@mui/material/Stack'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { es } from '../../i18n/es'
import { errorMessage } from '../../lib/api/errors'
import type { Tag, TagRequest } from '../../lib/api/types'
import { FormTextField } from '../form/FormTextField'
import { TagChip } from './TagChip'

/** Same palette the API seeds; any #RRGGBB is accepted by the API. */
const TAG_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
] as const

const tagSchema = z.object({
  name: z.string().trim().min(1, es.common.required).max(40, es.validation.maxLength(40)),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  description: z.string().max(200, es.validation.maxLength(200)),
})
type TagValues = z.infer<typeof tagSchema>

export function TagDialog({
  tag,
  onClose,
  onSubmit,
}: {
  tag: Tag | null
  onClose: () => void
  onSubmit: (values: TagRequest) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<TagValues>({
    resolver: zodResolver(tagSchema),
    defaultValues: {
      name: tag?.name ?? '',
      color: tag?.color ?? TAG_COLORS[5],
      description: tag?.description ?? '',
    },
  })
  const [name, color] = useWatch({ control, name: ['name', 'color'] })
  const preview = { id: 'preview', name: name || '…', color }

  const submit = handleSubmit(async (values) => {
    setError(null)
    try {
      await onSubmit({ ...values, description: values.description || null })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    }
  })

  return (
    <Dialog open onClose={formState.isSubmitting ? undefined : onClose} fullWidth maxWidth="xs">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {tag ? es.tags.form.editTitle : es.tags.form.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormTextField
              control={control}
              name="name"
              label={es.tags.form.name}
              placeholder={es.tags.form.namePlaceholder}
              autoFocus
              required
              fullWidth
            />
            <Controller
              name="color"
              control={control}
              render={({ field }) => (
                <Box>
                  <FormLabel sx={{ display: 'block', mb: 1, fontSize: 13, fontWeight: 600 }}>
                    {es.tags.form.color}
                  </FormLabel>
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {TAG_COLORS.map((color) => (
                      <ButtonBase
                        key={color}
                        aria-label={color}
                        aria-pressed={field.value === color}
                        onClick={() => field.onChange(color)}
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          bgcolor: color,
                          color: '#fff',
                          outline: field.value === color ? 2 : 0,
                          outlineColor: 'text.primary',
                          outlineOffset: 2,
                        }}
                      >
                        {field.value === color && <CheckOutlined fontSize="small" />}
                      </ButtonBase>
                    ))}
                  </Stack>
                </Box>
              )}
            />
            <FormTextField
              control={control}
              name="description"
              label={es.tags.form.description}
              placeholder={es.tags.form.descriptionPlaceholder}
              fullWidth
            />
            <Box>
              <TagChip tag={preview} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={formState.isSubmitting}>
            {es.common.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {es.tags.form.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
