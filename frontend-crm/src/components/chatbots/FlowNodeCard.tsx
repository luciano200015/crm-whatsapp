import EditOutlined from '@mui/icons-material/EditOutlined'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { es } from '../../i18n/es'
import type { NodeData } from '../../lib/api/chatbots'
import { useFlowEditor } from './flow-editor-context'
import { NODE_COLORS, outputsOf, preview, type EditorNode } from './flow-model'
import { NodeIcon } from './node-icons'

const handleSx = { width: 12, height: 12, border: '2px solid #fff' }

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
  const summary = preview(type, data)

  return (
    <Box
      aria-label={`${label}${summary ? `: ${summary}` : ''}`}
      sx={{
        width: 260,
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
        <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          {label}
        </Typography>
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
            aria-label={`${es.chatbots.editor.editNode}: ${label}`}
            onClick={() => onEdit(id)}
            sx={{ p: 0.25 }}
          >
            <EditOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Stack>
      <Box sx={{ px: 1.25, py: 1 }}>
        <NodeBody type={type} data={data} tags={tags} summary={summary} />
      </Box>
      {!single && outputs.length > 0 && (
        <Stack sx={{ pb: 0.5 }}>
          {outputs.map((output) => (
            <Box
              key={output.id}
              sx={{
                position: 'relative',
                mx: 1.25,
                mb: 0.5,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: 12,
                fontStyle: ['other', 'else', 'out'].includes(output.id) ? 'italic' : undefined,
              }}
            >
              <Typography variant="caption" noWrap component="div" sx={{ pr: 1 }}>
                {output.label}
              </Typography>
              <Handle
                type="source"
                id={output.id}
                position={Position.Right}
                style={{ ...handleSx, right: -17, background: color }}
              />
            </Box>
          ))}
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
  if (type === 'transfer') {
    const transfer = data as NodeData['transfer']
    const message = transfer.message ?? es.chatbots.node.transferMessageDefault
    return (
      <>
        <Typography variant="caption" component="div">
          {es.chatbots.node.transferOptions[transfer.to]}
        </Typography>
        {message.trim() && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            💬 {message}
          </Typography>
        )}
      </>
    )
  }
  if (type === 'hours') {
    const { schedule } = data as NodeData['hours']
    return (
      <Typography variant="caption" color="text.secondary">
        {schedule.timezone}
      </Typography>
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
  return summary ? (
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
      {summary}
    </Typography>
  ) : (
    <Typography variant="caption" sx={muted}>
      {es.chatbots.node.empty}
    </Typography>
  )
}

export const FlowNodeCard = memo(FlowNodeCardBase)
