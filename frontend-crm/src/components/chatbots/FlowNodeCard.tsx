import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { es } from '../../i18n/es'
import type { NodeData } from '../../lib/api/chatbots'
import { useFunnel } from '../funnels/useFunnels'
import { useFlowEditor } from './flow-editor-context'
import {
  NODE_COLORS,
  outputsOf,
  preview,
  titleOf,
  triggerOf,
  waitsForAnswer,
  type EditorNode,
} from './flow-model'
import { NodeIcon } from './node-icons'

const handleSx = { width: 12, height: 12, border: '2px solid #fff' }

/** Ways out that are an answer of the customer (buttons, options): green pills, as in WhatsApp. */
const FALLBACK_OUTPUTS = ['other', 'else', 'out']

/** Kinds whose text goes to the customer: shown in the "Respuesta del bot" box. */
const SENDS = new Set(['message', 'buttons', 'list', 'url', 'question'])

/**
 * A node on the canvas, as in wasapi: a card with what it sends and one
 * connection point per way out (each button, option or branch).
 */
function FlowNodeCardBase({ id, type, data, selected }: NodeProps<EditorNode>) {
  const { issues, tags, onEdit } = useFlowEditor()
  const color = NODE_COLORS[type]
  const mine = issues.get(id) ?? []
  const errors = mine.filter((issue) => issue.level === 'error')
  const outputs = outputsOf(type, data)
  const single = outputs.length === 1 && outputs[0]?.id === 'next'
  const label = es.chatbots.nodes[type].label
  const title = titleOf(data)
  const summary = preview(type, data)
  const pills = type === 'buttons' || type === 'list'
  const trigger = triggerOf(data).trim()
  const waits = waitsForAnswer(type, data)

  return (
    <Box
      aria-label={`${title || label}${summary ? `: ${summary}` : ''}`}
      sx={{
        width: 270,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: 2,
        borderColor: selected ? 'primary.main' : errors.length > 0 ? 'error.main' : 'divider',
        boxShadow: selected ? 6 : 2,
        overflow: 'visible',
        fontSize: 13,
      }}
    >
      {type !== 'start' && (
        <Handle type="target" position={Position.Top} style={{ ...handleSx, background: color }} />
      )}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          px: 1.25,
          py: 0.75,
          bgcolor: alpha(color, 0.14),
          borderBottom: 1,
          borderColor: 'divider',
          borderRadius: '6px 6px 0 0',
        }}
      >
        <NodeIcon kind={type} sx={{ color, fontSize: 18 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
            {title || label}
          </Typography>
          {title && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              noWrap
              sx={{ lineHeight: 1.2 }}
            >
              {label}
            </Typography>
          )}
        </Box>
        {mine.length > 0 && (
          <Tooltip title={mine.map((issue) => issue.message).join(' · ')}>
            {errors.length > 0 ? (
              <ErrorOutlineRounded color="error" sx={{ fontSize: 18 }} aria-label="Con errores" />
            ) : (
              <WarningAmberRounded color="warning" sx={{ fontSize: 18 }} aria-label="Con avisos" />
            )}
          </Tooltip>
        )}
        {type !== 'start' && (
          <IconButton
            size="small"
            className="nodrag"
            aria-label={`${es.chatbots.editor.editNode}: ${title || label}`}
            onClick={() => onEdit(id)}
            sx={{ p: 0.25 }}
          >
            <EditOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Stack>
      <Box sx={{ px: 1.25, py: 1 }}>
        <NodeBody type={type} data={data} tags={tags} summary={summary} />
        {(trigger || waits) && (
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
            {trigger && (
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={es.chatbots.node.triggerShort(trigger)}
                sx={{ maxWidth: '100%' }}
              />
            )}
            {waits && (
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label={es.chatbots.node.waiting}
              />
            )}
          </Stack>
        )}
      </Box>
      {!single && outputs.length > 0 && (
        <Stack sx={{ pb: 0.5 }}>
          {outputs.map((output) => {
            const fallback = FALLBACK_OUTPUTS.includes(output.id)
            const pill = pills && !fallback
            return (
              <Box
                key={output.id}
                sx={{
                  position: 'relative',
                  mx: 1.25,
                  mb: 0.5,
                  px: pill ? 1.5 : 1,
                  py: 0.5,
                  borderRadius: pill ? 999 : 1,
                  textAlign: pill ? 'center' : undefined,
                  bgcolor: pill ? '#25d366' : 'action.hover',
                  color: pill ? '#fff' : undefined,
                  fontWeight: pill ? 700 : undefined,
                  fontSize: 12,
                  fontStyle: fallback ? 'italic' : undefined,
                }}
              >
                <Typography
                  variant="caption"
                  noWrap
                  component="div"
                  sx={{ pr: 1, fontWeight: 'inherit' }}
                >
                  {output.label}
                </Typography>
                <Handle
                  type="source"
                  id={output.id}
                  position={Position.Right}
                  style={{ ...handleSx, right: -17, background: pill ? '#25d366' : color }}
                />
              </Box>
            )
          })}
        </Stack>
      )}
      {single && (
        <Handle
          type="source"
          id="next"
          position={Position.Bottom}
          style={{ ...handleSx, background: color }}
        />
      )}
    </Box>
  )
}

function NodeBody({
  type,
  data,
  tags,
  summary,
}: Pick<NodeProps<EditorNode>, 'type' | 'data'> & {
  tags: Map<string, { name: string; color: string }>
  summary: string
}) {
  const muted = { color: 'text.secondary', fontStyle: 'italic' } as const
  if (type === 'start' || type === 'end') {
    return (
      <Typography variant="caption" sx={muted}>
        {es.chatbots.nodes[type].help}
      </Typography>
    )
  }
  if (type === 'tags') {
    const { add, remove } = data as NodeData['tags']
    const chips = [
      ...add.map((id) => ({ id, prefix: '+' })),
      ...remove.map((id) => ({ id, prefix: '−' })),
    ]
    if (chips.length === 0)
      return (
        <Typography variant="caption" sx={muted}>
          {es.chatbots.node.empty}
        </Typography>
      )
    return (
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {chips.map((chip) => {
          const tag = tags.get(chip.id)
          return (
            <Chip
              key={`${chip.prefix}${chip.id}`}
              size="small"
              variant="outlined"
              label={`${chip.prefix} ${tag?.name ?? '?'}`}
              sx={{ borderColor: tag?.color, color: tag?.color, height: 20, fontSize: 11 }}
            />
          )
        })}
      </Stack>
    )
  }
  if (type === 'funnel') return <FunnelBody data={data as NodeData['funnel']} />
  if (type === 'transfer') {
    const transfer = data as NodeData['transfer']
    const message = transfer.message ?? es.chatbots.node.transferMessageDefault
    return (
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="caption" component="div">
          {es.chatbots.node.transferOptions[transfer.to]}
        </Typography>
        {message.trim() && <BotReply text={message} />}
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={es.chatbots.node.pauseShort[transfer.pause ?? '24h']}
          sx={{ height: 20, fontSize: 11 }}
        />
      </Stack>
    )
  }
  if (type === 'hours') {
    const { schedule } = data as NodeData['hours']
    const days = es.chatbots.schedule.days
    const open = schedule.days.filter((day) => day.ranges.length > 0)
    return (
      <Stack spacing={0.25}>
        <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
          {es.chatbots.node.hoursNotice}
        </Typography>
        {open.slice(0, 3).map((day) => (
          <Typography key={day.day} variant="caption" color="text.secondary" component="div" noWrap>
            {days[day.day]}: {day.ranges.map((range) => `${range.from}–${range.to}`).join(', ')}
          </Typography>
        ))}
        {open.length > 3 && (
          <Typography variant="caption" color="text.secondary" component="div">
            …
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" component="div">
          {schedule.timezone}
        </Typography>
      </Stack>
    )
  }
  if (type === 'condition') {
    const { rules } = data as NodeData['condition']
    return (
      <Stack spacing={0.25}>
        {rules.map((rule, index) => (
          <Typography key={rule.id} variant="caption" noWrap component="div">
            {index + 1}. {es.chatbots.node.sources[rule.source]}
            {rule.source === 'variable' && rule.variable ? ` {{${rule.variable}}}` : ''}{' '}
            {es.chatbots.node.operators[rule.operator]}
            {rule.value ? ` «${rule.value}»` : ''}
          </Typography>
        ))}
      </Stack>
    )
  }
  if (SENDS.has(type)) {
    const files = (data as { attachments?: unknown[] }).attachments?.length ?? 0
    const text = type === 'message' ? (data as NodeData['message']).text : summary
    return (
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        {files > 0 && (
          <Chip
            size="small"
            icon={<AttachFileRounded />}
            label={es.chatbots.node.files(files)}
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {text || files === 0 ? <BotReply text={text} /> : null}
        {type === 'question' && (data as NodeData['question']).variable && (
          <Typography variant="caption" color="text.secondary">
            → {`{{${(data as NodeData['question']).variable}}}`}
          </Typography>
        )}
      </Stack>
    )
  }
  return summary ? (
    <Typography variant="caption" component="div">
      {summary}
    </Typography>
  ) : (
    <Typography variant="caption" sx={muted}>
      {es.chatbots.node.empty}
    </Typography>
  )
}

/** "Respuesta del bot": what the customer reads, in a box like wasapi's. */
function BotReply({ text }: { text: string }) {
  return (
    <Box
      sx={{
        width: '100%',
        boxSizing: 'border-box',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        px: 1,
        py: 0.75,
        bgcolor: 'action.hover',
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {es.chatbots.node.botReply}
      </Typography>
      {text ? (
        <Typography
          variant="caption"
          component="div"
          sx={{
            whiteSpace: 'pre-wrap',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {text}
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          {es.chatbots.node.empty}
        </Typography>
      )}
    </Box>
  )
}

export const FlowNodeCard = memo(FlowNodeCardBase)

/** "Ventas → En atención". */
function FunnelBody({ data }: { data: NodeData['funnel'] }) {
  const funnel = useFunnel(data.funnelId)
  if (!data.funnelId)
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
        {es.chatbots.node.empty}
      </Typography>
    )
  const stage = funnel.data?.stages.find((item) => item.id === data.stageId)
  return (
    <Typography variant="caption" component="div">
      {funnel.data?.name ?? '…'} → {stage?.name ?? '?'}
    </Typography>
  )
}
