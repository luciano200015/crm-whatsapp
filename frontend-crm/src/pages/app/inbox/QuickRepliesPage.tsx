import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageHeader } from '../../../components/PageHeader'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { errorMessage } from '../../../lib/api/errors'
import { quickRepliesApi, quickReplyKeys, type QuickReply } from '../../../lib/api/quick-replies'
import { useActiveWorkspace } from '../../../workspace/active-workspace-context'

const SHORTCUT = /^\/?[a-zA-Z0-9_-]{1,32}$/

function QuickReplyDialog({
  reply,
  saving,
  onClose,
  onSave,
}: {
  reply: QuickReply | null
  saving: boolean
  onClose: () => void
  onSave: (values: { shortcut: string; text: string }) => void
}) {
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? '')
  const [text, setText] = useState(reply?.text ?? '')
  const shortcutError =
    shortcut && !SHORTCUT.test(shortcut.trim())
      ? 'Solo letras, números, «-» y «_», sin espacios (máximo 32).'
      : null
  const valid = !!shortcut.trim() && !shortcutError && !!text.trim()
  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{reply ? 'Editar respuesta rápida' : 'Nueva respuesta rápida'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Atajo"
            value={shortcut}
            onChange={(event) => setShortcut(event.target.value)}
            error={!!shortcutError}
            helperText={shortcutError ?? 'En el chat escribe «/» y el atajo, por ejemplo /saludo.'}
            slotProps={{ input: { startAdornment: <span>/</span> } }}
            required
            autoFocus
          />
          <TextField
            label="Mensaje"
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={3}
            maxRows={10}
            slotProps={{ htmlInput: { maxLength: 4096 } }}
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={!valid || saving}
          onClick={() =>
            onSave({ shortcut: shortcut.trim().replace(/^\//, ''), text: text.trim() })
          }
        >
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Respuestas rápidas: saved answers agents insert with "/" (quick_replies.manage). */
export function QuickRepliesPage() {
  useDocumentTitle('Respuestas rápidas')
  const workspaceId = useActiveWorkspace().active?.id ?? ''
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [editing, setEditing] = useState<QuickReply | 'new' | null>(null)
  const [deleting, setDeleting] = useState<QuickReply | null>(null)
  const replies = useQuery({
    queryKey: quickReplyKeys.all(workspaceId),
    queryFn: ({ signal }) => quickRepliesApi.list(workspaceId, signal),
    enabled: !!workspaceId,
  })
  const refresh = () => client.invalidateQueries({ queryKey: quickReplyKeys.all(workspaceId) })
  const save = useMutation({
    mutationFn: (values: { shortcut: string; text: string }) =>
      editing && editing !== 'new'
        ? quickRepliesApi.update(workspaceId, editing.id, values)
        : quickRepliesApi.create(workspaceId, values),
    onSuccess: async () => {
      enqueueSnackbar(editing === 'new' ? 'Respuesta rápida creada' : 'Respuesta rápida guardada', {
        variant: 'success',
      })
      setEditing(null)
      await refresh()
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  const remove = useMutation({
    mutationFn: (reply: QuickReply) => quickRepliesApi.remove(workspaceId, reply.id),
    onSuccess: async () => {
      setDeleting(null)
      enqueueSnackbar('Respuesta rápida eliminada', { variant: 'success' })
      await refresh()
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Respuestas rápidas"
        subtitle="Mensajes guardados que tu equipo inserta en el chat escribiendo «/» y el atajo."
      />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing('new')}>
          Nueva respuesta rápida
        </Button>
      </Box>
      {replies.isPending ? (
        <Skeleton variant="rounded" height={160} />
      ) : replies.isError ? (
        <Alert severity="error">{errorMessage(replies.error)}</Alert>
      ) : replies.data.length === 0 ? (
        <Alert severity="info">
          Aún no hay respuestas rápidas. Crea la primera, por ejemplo /saludo.
        </Alert>
      ) : (
        <Card variant="outlined">
          <List disablePadding>
            {replies.data.map((reply, index) => (
              <ListItem
                key={reply.id}
                divider={index < replies.data.length - 1}
                secondaryAction={
                  <Stack direction="row">
                    <Tooltip title="Editar">
                      <IconButton
                        aria-label={`Editar /${reply.shortcut}`}
                        onClick={() => setEditing(reply)}
                      >
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar">
                      <IconButton
                        aria-label={`Eliminar /${reply.shortcut}`}
                        onClick={() => setDeleting(reply)}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
                sx={{ pr: 12 }}
              >
                <ListItemText
                  primary={
                    <Chip size="small" label={`/${reply.shortcut}`} sx={{ fontWeight: 600 }} />
                  }
                  secondary={reply.text}
                  slotProps={{
                    secondary: {
                      sx: { mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
                    },
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Card>
      )}
      {editing && (
        <QuickReplyDialog
          reply={editing === 'new' ? null : editing}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(values) => save.mutate(values)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar respuesta rápida"
        confirmLabel="Eliminar"
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {`¿Eliminar /${deleting?.shortcut ?? ''}? Tu equipo ya no podrá usarla.`}
      </ConfirmDialog>
    </Stack>
  )
}
