import Box from '@mui/material/Box'
import FormLabel from '@mui/material/FormLabel'
import TextField, { type TextFieldProps } from '@mui/material/TextField'
import { useId } from 'react'
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

export type FormTextFieldProps<T extends FieldValues> = Omit<
  TextFieldProps,
  'name' | 'label' | 'value' | 'onChange' | 'onBlur' | 'error'
> & {
  name: FieldPath<T>
  control: Control<T>
  label: string
}

/**
 * Text field bound to react-hook-form, with the label above the input and a
 * red asterisk for required fields (same pattern as the reference design).
 */
export function FormTextField<T extends FieldValues>({
  name,
  control,
  label,
  required,
  helperText,
  ...props
}: FormTextFieldProps<T>) {
  const id = useId()
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Box>
          <FormLabel
            htmlFor={id}
            required={required}
            sx={{
              display: 'block',
              mb: 0.75,
              fontSize: 13,
              fontWeight: 600,
              color: 'text.secondary',
              '& .MuiFormLabel-asterisk': { color: 'error.main' },
            }}
          >
            {label}
          </FormLabel>
          <TextField
            {...props}
            {...field}
            id={id}
            value={field.value ?? ''}
            inputRef={field.ref}
            error={Boolean(fieldState.error)}
            helperText={fieldState.error?.message ?? helperText}
            slotProps={{
              ...props.slotProps,
              htmlInput: { 'aria-required': required, ...props.slotProps?.htmlInput },
            }}
          />
        </Box>
      )}
    />
  )
}
