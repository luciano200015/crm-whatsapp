import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import { useState } from 'react'
import type { FieldValues } from 'react-hook-form'
import { FormTextField, type FormTextFieldProps } from './FormTextField'

/** Password input with a show/hide toggle. */
export function PasswordField<T extends FieldValues>(props: FormTextFieldProps<T>) {
  const [visible, setVisible] = useState(false)
  const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña'

  return (
    <FormTextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        ...props.slotProps,
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label={label}
                onClick={() => setVisible((v) => !v)}
                onMouseDown={(event) => event.preventDefault()}
                edge="end"
                size="small"
              >
                {visible ? (
                  <VisibilityOffOutlined fontSize="small" />
                ) : (
                  <VisibilityOutlined fontSize="small" />
                )}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
