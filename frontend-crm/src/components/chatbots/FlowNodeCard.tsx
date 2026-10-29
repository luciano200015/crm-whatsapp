import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import CancelRounded from '@mui/icons-material/CancelRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded'
import MoreVertRounded from '@mui/icons-material/MoreVertRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Chip,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo, useState, type ReactNode } from 'react'
import { es } from '../../i18n/es'
import type { NodeData } from '../../lib/api/chatbots'
import { useFunnel } from '../funnels/useFunnels'
import { fieldVariable, useFlowEditor } from './flow-editor-context'
import {
  HANDLE_COLOR,
  NODE_COLORS,
  optionsOf,
  outputsOf,
  preview,
  ruleText,
  sentAsButtons,
  titleOf,
  waitsForAnswer,
  type EditorNode,
  type Output,
} from './flow-model'
import { NodeIcon } from './node-icons'

const t = es.chatbots.node
const handleSx = { width: 12, height: 12, border: '2px solid #fff', background: HANDLE_COLOR }

/**
 * A node on the canvas, as in wasapi: a white card with a grey header,
 * «Mensaje de usuario» (what opens it), «Respuesta del bot», its buttons as
 * green pills, or «Acción a realizar», and one green point per way out.
 */
function FlowNodeCardBase({ id, type, data, selected }: NodeProps<EditorNode>) {
  const { issues, userMessages, onEdit, onDuplicate, onDelete } = useFlowEditor()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const mine = issues.get(id) ?? []
  const errors = mine.filter((issue) => issue.level === 'error')
  const outputs = outputsOf(type, data)
  const pills = type === 'message' && optionsOf(data).length > 0
  const single = outputs.length === 1 && outputs[0]?.id === 'next'
  const label = es.chatbots.nodes[type].label
  const title = titleOf(data)
  const summary = preview(type, data)
  const opener = userMessages.get(id)
  const name = title || label

  return (
    <Box
      aria-label={`${name}${summary ? `: ${summary}` : ''}`}
      sx={{
        width: 270,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: selected ? 2 : 1,
        borderColor: selected ? 'success.main' : errors.length > 0 ? 'error.main' : 'divider',
        boxShadow: selected ? 6 : 2,
        fontSize: 13,
      }}
    >
      {type !== 'start' && <Handle type="target" position={Position.Top} style={handleSx} />}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          pl: 1.25,
          pr: 0.5,
          py: 0.5,
          bgcolor: 'action.hover',
          borderBottom: 1,
          borderColor: 'divider',
          borderRadius: '7px 7px 0 0',
        }}
      >
        <NodeIcon kind={type} sx={{ color: NODE_COLORS[type], fontSize: 18 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
            {name}
          </Typography>
          {title && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
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
          <>
            <IconButton
              size="small"
              className="nodrag"
              aria-label={`${es.chatbots.editor.editNode}: ${name}`}
              onClick={() => onEdit(id)}
              sx={{ p: 0.25 }}
            >
              <EditOutlined sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              className="nodrag"
              aria-label={es.chatbots.editor.nodeMenu(name)}
              onClick={(event) => setMenu(event.currentTarget)}
              sx={{ p: 0.25 }}
            >
              <MoreVertRounded sx={{ fontSize: 18 }} />
            </IconButton>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              {(
                [
                  [es.chatbots.editor.edit, () => onEdit(id)],
                  [es.chatbots.editor.duplicateNode, () => onDuplicate(id)],
                  [es.chatbots.editor.deleteNode, () => onDelete(id)],
                ] as const
              ).map(([text, action]) => (
                <MenuItem
                  key={text}
                  onClick={() => {
                    setMenu(null)
                    action()
                  }}
                >
                  <ListItemText>{text}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Stack>
      <Stack spacing={0.75} sx={{ px: 1.25, py: 1 }}>
        {opener && (
          <Box
            sx={{
              border: 1,
              borderColor: 'success.light',
              bgcolor: 'rgba(34, 197, 94, 0.1)',
              borderRadius: 1.5,
              px: 1,
              py: 0.5,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700 }} component="div">
              {t.userMessage}
            </Typography>
            <Typography variant="caption" component="div" noWrap>
              {opener}
            </Typography>
          </Box>
        )}
        <NodeBody type={type} data={data} />
      </Stack>
      {pills && <Pills data={data as NodeData['message']} outputs={outputs} />}
      {!pills && !single && outputs.length > 0 && <Branches outputs={outputs} />}
      {single && <Handle type="source" id="next" position={Position.Bottom} style={handleSx} />}
    </Box>
  )
}

/** «Botones» or «Lista: <name>», each option a green pill with its own point. */
function Pills({ data, outputs }: { data: NodeData['message']; outputs: Output[] }) {
  const list = !sentAsButtons(data.options)
  return (
    <Box sx={{ mx: 1.25, mb: 1, border: 1, borderColor: 'divider', borderRadius: 1.5, p: 0.75 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        {list && <FormatListBulletedRounded sx={{ fontSize: 14 }} />}
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {list ? t.listName(data.listButton || t.listButtonDefault) : t.buttonsBox}
        </Typography>
      </Stack>
      <Stack spacing={0.5}>
        {outputs.map((output) => (
          <Box
            key={output.id}
            sx={{
              position: 'relative',
              px: 1.5,
              py: 0.4,
              borderRadius: 999,
              textAlign: 'center',
              bgcolor: HANDLE_COLOR,
              color: '#fff',
              fontWeight: 700,
            }}
          >
            <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 'inherit' }}>
              {output.label}
            </Typography>
            <Handle
              type="source"
              id={output.id}
              position={Position.Right}
              style={{ ...handleSx, right: -18 }}
            />
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

/** Named ways out: ✓ / ✗ rows (Cumple / No cumple, Dentro / Fuera…). */
function Branches({ outputs }: { outputs: Output[] }) {
  return (
    <Stack spacing={0.5} sx={{ pb: 1 }}>
      {outputs.map((output) => (
        <Stack
          key={output.id}
          direction="row"
          spacing={0.75}
          sx={{
            position: 'relative',
            alignItems: 'center',
            mx: 1.25,
            px: 1,
            py: 0.5,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        >
          {output.mark === 'yes' && <CheckCircleRounded color="success" sx={{ fontSize: 16 }} />}
          {output.mark === 'no' && <CancelRounded color="error" sx={{ fontSize: 16 }} />}
          <Typography variant="caption" noWrap component="div" sx={{ flex: 1, fontWeight: 600 }}>
            {output.label}
          </Typography>
          <Handle
            type="source"
            id={output.id}
            position={Position.Right}
            style={{ ...handleSx, right: -18 }}
          />
        </Stack>
      ))}
    </Stack>
  )
}

/** A bordered box with a bold heading, like wasapi's «Respuesta del Bot:». */
function Box2({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1, py: 0.75 }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }} component="div">
        {heading}
      </Typography>
      {children}
    </Box>
  )
}

/** Orange «No hay … configurado». */
function Missing({ text }: { text: string }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'warning.light',
        bgcolor: 'rgba(249, 115, 22, 0.1)',
        color: 'warning.dark',
        borderRadius: 1.5,
        px: 1,
        py: 0.75,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
    </Box>
  )
}

const clamp = {
  whiteSpace: 'pre-wrap',
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as const

function BotReply({ text, files = 0 }: { text: string; files?: number }) {
  return (
    <Box2 heading={t.botReplyBox}>
      {files > 0 && (
        <Chip
          size="small"
          icon={<AttachFileRounded />}
          label={t.files(files)}
          sx={{ height: 20, fontSize: 11, my: 0.25 }}
        />
      )}
      {text ? (
        <Typography variant="caption" component="div" sx={clamp}>
          {text}
        </Typography>
      ) : files === 0 ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          {t.empty}
        </Typography>
      ) : null}
    </Box2>
  )
}

/** «Acción a realizar»: what the card does, and that it moves on. */
function Action({ children, next = true }: { children: ReactNode; next?: boolean }) {
  return (
    <Box2 heading={t.action}>
      <Typography variant="caption" component="div">
        {children}
      </Typography>
      {next && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {t.jumpsNext}
        </Typography>
      )}
    </Box2>
  )
}

function NodeBody({ type, data }: Pick<NodeProps<EditorNode>, 'type' | 'data'>) {
  const { tags, contactFields } = useFlowEditor()
  const muted = { color: 'text.secondary', fontStyle: 'italic' } as const
  switch (type) {
    case 'start':
    case 'end':
      return (
        <Typography variant="caption" sx={muted}>
          {es.chatbots.nodes[type].help}
        </Typography>
      )
    case 'message': {
      const message = data as NodeData['message']
      return (
        <>
          <BotReply text={message.text} files={message.attachments.length} />
          {waitsForAnswer(type, data) && (
            <Chip size="small" variant="outlined" color="warning" label={t.waiting} />
          )}
        </>
      )
    }
    case 'url': {
      const url = data as NodeData['url']
      return (
        <>
          <BotReply text={url.body} files={url.attachment ? 1 : 0} />
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: 'center', alignItems: 'center', color: 'info.main' }}
          >
            <OpenInNewRounded sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
              {url.text}
            </Typography>
          </Stack>
        </>
      )
    }
    case 'question': {
      const question = data as NodeData['question']
      return (
        <>
          {question.text ? (
            <BotReply text={question.text} />
          ) : (
            <Typography variant="caption" component="div">
              {t.savesMessage}
            </Typography>
          )}
          {question.variable ? (
            <Typography variant="caption" color="text.secondary">
              {t.savesIn(question.variable)}
            </Typography>
          ) : (
            <Missing text={t.empty} />
          )}
        </>
      )
    }
    case 'location': {
      const place = data as NodeData['location']
      if (place.latitude === null || place.longitude === null)
        return <Missing text={t.noLocation} />
      return (
        <Box2 heading={es.chatbots.tester.location}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600 }} noWrap>
            📍 {place.name || `${place.latitude}, ${place.longitude}`}
          </Typography>
          {place.address && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {place.address}
            </Typography>
          )}
        </Box2>
      )
    }
    case 'contact_card': {
      const { contacts } = data as NodeData['contact_card']
      const named = contacts.filter((contact) => contact.name.trim())
      if (named.length === 0) return <Missing text={t.noContacts} />
      return (
        <Box2 heading={t.contacts}>
          {named.map((contact, index) => (
            <Typography key={index} variant="caption" component="div" noWrap>
              👤 {contact.name}
            </Typography>
          ))}
        </Box2>
      )
    }
    case 'tags': {
      const { add, remove } = data as NodeData['tags']
      const chips = [
        ...add.map((tagId) => ({ tagId, prefix: '+' })),
        ...remove.map((tagId) => ({ tagId, prefix: '−' })),
      ]
      if (chips.length === 0) return <Missing text={t.noTags} />
      return (
        <Action>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
            {chips.map((chip) => {
              const tag = tags.get(chip.tagId)
              return (
                <Chip
                  key={`${chip.prefix}${chip.tagId}`}
                  size="small"
                  variant="outlined"
                  label={`${chip.prefix} ${tag?.name ?? '?'}`}
                  sx={{ borderColor: tag?.color, color: tag?.color, height: 20, fontSize: 11 }}
                />
              )
            })}
          </Stack>
        </Action>
      )
    }
    case 'funnel':
      return <FunnelBody data={data as NodeData['funnel']} />
    case 'contact_field': {
      const field = data as NodeData['contact_field']
      if (!field.field) return <Missing text={t.noField} />
      const name =
        t.fieldNames[field.field] ??
        contactFields.find((item) => item.key === field.field)?.label ??
        `{{${fieldVariable(field.field)}}}`
      return (
        <Action next={false}>
          {t.fieldUpdate(name)} {field.source === 'answer' ? t.fieldFromAnswer : `= ${field.value}`}
        </Action>
      )
    }
    case 'api': {
      const api = data as NodeData['api']
      if (!/^https:\/\/\S+\.\S+/.test(api.url)) return <Missing text={t.noApi} />
      return (
        <Action next={false}>
          <Box component="span" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {t.apiCall(api.method, api.url)}
          </Box>
        </Action>
      )
    }
    case 'transfer': {
      const transfer = data as NodeData['transfer']
      const message = transfer.message ?? t.transferMessageDefault
      return (
        <>
          {message.trim() && <BotReply text={message} />}
          <Action next={false}>
            {t.transferOptions[transfer.to]}
            {transfer.note?.trim() && (
              <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                📝 {transfer.note}
              </Box>
            )}
          </Action>
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={t.pauseShort[transfer.pause ?? '24h']}
            sx={{ height: 20, fontSize: 11, alignSelf: 'flex-start' }}
          />
        </>
      )
    }
    case 'status': {
      const status = data as NodeData['status']
      const paused = status.bot === 'pause'
      return (
        <Action next={status.status !== 'CLOSED' && !paused}>
          {t.statusTo(t.statuses[status.status])}
          {paused && (
            <Box component="span" sx={{ display: 'block', color: 'error.main' }}>
              {t.botPaused}
            </Box>
          )}
        </Action>
      )
    }
    case 'hours': {
      const { schedule } = data as NodeData['hours']
      const days = es.chatbots.schedule.days
      const open = schedule.days.filter((day) => day.ranges.length > 0)
      return (
        <Box2 heading={schedule.timezone}>
          {open.slice(0, 3).map((day) => (
            <Typography key={day.day} variant="caption" component="div" noWrap>
              {days[day.day]}: {day.ranges.map((range) => `${range.from}–${range.to}`).join(', ')}
            </Typography>
          ))}
          {open.length > 3 && (
            <Typography variant="caption" color="text.secondary" component="div">
              …
            </Typography>
          )}
        </Box2>
      )
    }
    case 'condition': {
      const condition = data as NodeData['condition']
      if (condition.rules.length === 0) return <Missing text={t.noRules} />
      return (
        <Box2 heading={`${t.rules} · ${t.matchShort[condition.match]}`}>
          {condition.rules.map((rule, index) => (
            <Typography key={rule.id} variant="caption" noWrap component="div">
              {index + 1}. {ruleText(rule)}
            </Typography>
          ))}
        </Box2>
      )
    }
  }
}

export const FlowNodeCard = memo(FlowNodeCardBase)

/** "Ventas → En atención". */
function FunnelBody({ data }: { data: NodeData['funnel'] }) {
  const funnel = useFunnel(data.funnelId)
  if (!data.funnelId) return <Missing text={t.noFunnel} />
  const stage = funnel.data?.stages.find((item) => item.id === data.stageId)
  return (
    <Action>
      {funnel.data?.name ?? '…'} → {stage?.name ?? '?'}
    </Action>
  )
}
