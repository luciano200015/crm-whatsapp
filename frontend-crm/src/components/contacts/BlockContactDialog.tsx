import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { contactKeys, contactsApi } from '../../lib/api/contacts'
import { errorMessage } from '../../lib/api/errors'
import { inboxKeys } from '../../lib/api/inbox'
import type { BlockResult } from '../../lib/api/types'
import { ConfirmDialog } from '../ConfirmDialog'

export interface BlockTarget {
  id: string
  name: string
  blocked: boolean
}

function outcome(result: BlockResult): { message: string; variant: 'success' | 'warning' } {
  if (!result.blocked) return { message: 'Contacto desbloqueado', variant: 'success' }
  const refused = result.whatsapp.filter((line) => !line.ok)
  if (refused.length === 0) return { message: 'Contacto bloqueado', variant: 'success' }
  const lines = refused.map((line) => `«${line.lineName}»`).join(', ')
  return {
    message: `Bloqueado en el CRM. WhatsApp no lo bloqueó en ${lines}: ${refused[0]?.error ?? 'error desconocido'}. WhatsApp solo permite bloquear a quien escribió en las últimas 24 horas.`,
    variant: 'warning',
  }
}

/** Confirms and blocks (or unblocks) a contact, in the CRM and on WhatsApp. */
export function BlockContactDialog({
  workspaceId,
  contact,
  onClose,
}: {
  workspaceId: string
  contact: BlockTarget | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const block = useMutation({
    mutationFn: (target: BlockTarget) =>
      contactsApi.setBlocked(workspaceId, target.id, !target.blocked),
    onSuccess: (result) => {
      const { message, variant } = outcome(result)
      enqueueSnackbar(message, { variant })
      void client.invalidateQueries({ queryKey: contactKeys.all(workspaceId) })
      void client.invalidateQueries({ queryKey: inboxKeys.all(workspaceId) })
      onClose()
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  })
  const blocking = !contact?.blocked
  return (
    <ConfirmDialog
      open={contact !== null}
      title={blocking ? 'Bloquear contacto' : 'Desbloquear contacto'}
      confirmLabel={blocking ? 'Bloquear' : 'Desbloquear'}
      danger={blocking}
      loading={block.isPending}
      onClose={onClose}
      onConfirm={() => contact && block.mutate(contact)}
    >
      {blocking
        ? `${contact?.name ?? ''} no podrá escribirte: sus mensajes se ignoran, sus chats abiertos se cierran y se bloquea su número en WhatsApp.`
        : `${contact?.name ?? ''} podrá volver a escribirte y sus mensajes abrirán chats nuevos.`}
    </ConfirmDialog>
  )
}
