import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import AltRouteRounded from '@mui/icons-material/AltRouteRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import FlagRounded from '@mui/icons-material/FlagRounded'
import LinkRounded from '@mui/icons-material/LinkRounded'
import ListAltRounded from '@mui/icons-material/ListAltRounded'
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import QuestionAnswerOutlined from '@mui/icons-material/QuestionAnswerOutlined'
import SmartButtonRounded from '@mui/icons-material/SmartButtonRounded'
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded'
import SyncAltRounded from '@mui/icons-material/SyncAltRounded'
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined'
import type { SvgIconProps } from '@mui/material'
import type { NodeKind } from '../../lib/api/chatbots'

const ICONS: Record<NodeKind, typeof PlayArrowRounded> = {
  start: PlayArrowRounded,
  message: ChatBubbleOutlineRounded,
  buttons: SmartButtonRounded,
  list: ListAltRounded,
  url: LinkRounded,
  question: QuestionAnswerOutlined,
  condition: AltRouteRounded,
  hours: AccessTimeRounded,
  tags: LocalOfferOutlined,
  funnel: ViewKanbanOutlined,
  transfer: SupportAgentRounded,
  status: SyncAltRounded,
  end: FlagRounded,
}

/** The icon of a kind of node (canvas, palette, editor). */
export function NodeIcon({ kind, ...props }: { kind: NodeKind } & SvgIconProps) {
  const Icon = ICONS[kind]
  return <Icon {...props} />
}
