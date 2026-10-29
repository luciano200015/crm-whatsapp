import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import NorthRounded from '@mui/icons-material/NorthRounded'
import { Alert, Avatar, Box, Button, Chip, IconButton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { es } from '../../i18n/es'
import type { NodeData, NodeKind } from '../../lib/api/chatbots'
import type { TagSummary } from '../../lib/api/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { ANY_MESSAGE, LIMITS, NODE_COLORS, titleOf, triggerOf, type EditorNode } from './flow-model'
import { NodeIcon } from './node-icons'
import {
  ContactFieldForm,
  FunnelForm,
  StatusForm,
  TagsForm,
  TransferForm,
  type Member,
} from './node-forms/action-forms'
import { ApiForm } from './node-forms/ApiForm'
import { LimitedField } from './node-forms/fields'
import { ConditionForm, HoursForm } from './node-forms/logic-forms'
import {
  ContactCardForm,
  LocationForm,
  MessageForm,
  QuestionForm,
  UrlForm,
} from './node-forms/message-forms'

export type { Member }

const t = es.chatbots.node

/**
 * Settings of the selected node, in a side panel as in wasapi: the changes
 * stay in a draft until «Actualizar» puts them on the canvas; «Guardar»
 * stores the flow.
 */
export function NodeEditor({
  workspaceId,
  chatbotId,
  node,
  triggerLocked,
  tags,
  members,
  onApply,
  onDelete,
  onClose,
  onDirtyChange,
}: {
  workspaceId: string
  chatbotId: string
  node: EditorNode
  /** Something that moves on by itself (an option, a card that jumps…) connects to it. */
  triggerLocked: boolean
  tags: TagSummary[]
  members: Member[]
  onApply: (data: Record<string, unknown>) => void
  onDelete: () => void
  onClose: () => void
  /** Whether there are changes «Actualizar» has not applied. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const kind = node.type as NodeKind
  const [draft, setDraft] = useState(node.data)
  const [helpOpen, setHelpOpen] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const dirty = draft !== node.data
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const change = (changes: Record<string, unknown>) =>
    setDraft((before) => ({ ...before, ...changes }))
  const trigger = triggerLocked ? '' : triggerOf(draft)
  const color = NODE_COLORS[kind]
  const close = () => (dirty ? setConfirming(true) : onClose())

  return (
    <Stack sx={{ height: '100%' }} aria-label={es.chatbots.editor.editNode}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Avatar sx={{ bgcolor: alpha(color, 0.14), color, width: 36, height: 36 }}>
          <NodeIcon kind={kind} fontSize="small" />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>
            {es.chatbots.nodes[kind].label}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {es.chatbots.nodes[kind].help}
          </Typography>
        </Box>
        <IconButton aria-label={es.chatbots.editor.close} onClick={close}>
          <CloseRounded />
        </IconButton>
      </Stack>
      <Stack spacing={2.25} sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        <LimitedField
          label={t.title}
          value={titleOf(draft)}
          max={LIMITS.title}
          placeholder={es.chatbots.nodes[kind].label}
          helperText={t.titleHelp}
          onValue={(title) => change({ title })}
        />
        {kind !== 'start' && (
          <Stack spacing={1}>
            {trigger === ANY_MESSAGE ? (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t.trigger}
                </Typography>
                <Box>
                  <Chip
                    color="success"
                    label={t.acceptsAny}
                    onDelete={() => change({ trigger: '' })}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" component="p">
                  {t.acceptAnyHelp}
                </Typography>
              </Box>
            ) : (
              <>
                <LimitedField
                  label={t.trigger}
                  value={trigger}
                  max={LIMITS.trigger}
                  disabled={triggerLocked}
                  placeholder={t.triggerPlaceholder}
                  helperText={t.triggerHelp}
                  onValue={(value) => change({ trigger: value })}
                />
                {!triggerLocked && (
                  <Box>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      disableElevation
                      startIcon={<NorthRounded />}
                      onClick={() => change({ trigger: ANY_MESSAGE })}
                    >
                      {t.acceptAny}
                    </Button>
                  </Box>
                )}
              </>
            )}
            {triggerLocked && <Alert severity="info">{t.triggerLocked}</Alert>}
          </Stack>
        )}
        {helpOpen && (
          <Alert
            severity="info"
            icon={false}
            onClose={() => setHelpOpen(false)}
            closeText={t.hideHelp}
            sx={{ bgcolor: alpha('#0ea5e9', 0.1), '& .MuiAlert-message': { width: '100%' } }}
          >
            <Typography variant="body2">{es.chatbots.nodes[kind].guide}</Typography>
          </Alert>
        )}
        <NodeForm
          workspaceId={workspaceId}
          chatbotId={chatbotId}
          kind={kind}
          data={draft}
          trigger={trigger}
          tags={tags}
          members={members}
          onChange={change}
        />
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        {kind !== 'start' && (
          <IconButton color="error" aria-label={es.chatbots.editor.deleteNode} onClick={onDelete}>
            <DeleteOutlineRounded />
          </IconButton>
        )}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={close}>
          {es.chatbots.editor.close}
        </Button>
        <Button
          variant="contained"
          color="success"
          disableElevation
          disabled={!dirty}
          onClick={() => onApply(draft)}
        >
          {es.chatbots.editor.update}
        </Button>
      </Stack>
      <ConfirmDialog
        open={confirming}
        title={es.chatbots.editor.discardTitle}
        confirmLabel={es.chatbots.editor.discard}
        danger
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onClose()
        }}
      >
        {es.chatbots.editor.discardBody}
      </ConfirmDialog>
    </Stack>
  )
}

function NodeForm({
  workspaceId,
  chatbotId,
  kind,
  data,
  trigger,
  tags,
  members,
  onChange,
}: {
  workspaceId: string
  chatbotId: string
  kind: NodeKind
  data: Record<string, unknown>
  trigger: string
  tags: TagSummary[]
  members: Member[]
  onChange: (changes: Record<string, unknown>) => void
}) {
  const files = { workspaceId, chatbotId }
  switch (kind) {
    case 'start':
    case 'end':
      return null
    case 'message':
      return <MessageForm {...files} data={data as NodeData['message']} onChange={onChange} />
    case 'url':
      return <UrlForm {...files} data={data as NodeData['url']} onChange={onChange} />
    case 'question':
      return (
        <QuestionForm data={data as NodeData['question']} trigger={trigger} onChange={onChange} />
      )
    case 'location':
      return <LocationForm data={data as NodeData['location']} onChange={onChange} />
    case 'contact_card':
      return <ContactCardForm data={data as NodeData['contact_card']} onChange={onChange} />
    case 'condition':
      return <ConditionForm data={data as NodeData['condition']} onChange={onChange} />
    case 'hours':
      return <HoursForm data={data as NodeData['hours']} onChange={onChange} />
    case 'tags':
      return <TagsForm data={data as NodeData['tags']} tags={tags} onChange={onChange} />
    case 'funnel':
      return <FunnelForm data={data as NodeData['funnel']} onChange={onChange} />
    case 'contact_field':
      return <ContactFieldForm data={data as NodeData['contact_field']} onChange={onChange} />
    case 'api':
      return (
        <ApiForm workspaceId={workspaceId} data={data as NodeData['api']} onChange={onChange} />
      )
    case 'transfer':
      return (
        <TransferForm data={data as NodeData['transfer']} members={members} onChange={onChange} />
      )
    case 'status':
      return <StatusForm data={data as NodeData['status']} onChange={onChange} />
  }
}
