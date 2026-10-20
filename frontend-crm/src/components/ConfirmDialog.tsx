import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import type { ReactNode } from 'react'
import { es } from '../i18n/es'

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{children}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          {es.common.cancel}
        </Button>
        <Button
          variant="contained"
          color={danger ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={loading}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
