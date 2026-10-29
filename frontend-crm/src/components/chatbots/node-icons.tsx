import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import AltRouteRounded from '@mui/icons-material/AltRouteRounded'
import ApiRounded from '@mui/icons-material/ApiRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import ContactPhoneOutlined from '@mui/icons-material/ContactPhoneOutlined'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import FlagRounded from '@mui/icons-material/FlagRounded'
import LinkRounded from '@mui/icons-material/LinkRounded'
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined'
import PlaceOutlined from '@mui/icons-material/PlaceOutlined'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import SaveAltRounded from '@mui/icons-material/SaveAltRounded'
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded'
import SyncAltRounded from '@mui/icons-material/SyncAltRounded'
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined'
import type { SvgIconProps } from '@mui/material'
import type { NodeKind } from '../../lib/api/chatbots'

const ICONS: Record<NodeKind, typeof PlayArrowRounded> = {
  start: PlayArrowRounded,
  message: ChatBubbleOutlineRounded,
  url: LinkRounded,
  question: SaveAltRounded,
  location: PlaceOutlined,
  contact_card: ContactPhoneOutlined,
  condition: AltRouteRounded,
  hours: AccessTimeRounded,
  tags: LocalOfferOutlined,
  funnel: ViewKanbanOutlined,
  contact_field: EditNoteRounded,
  api: ApiRounded,
  transfer: SupportAgentRounded,
  status: SyncAltRounded,
  end: FlagRounded,
}

/** The icon of a kind of node (canvas, palette, editor). */
export function NodeIcon({ kind, ...props }: { kind: NodeKind } & SvgIconProps) {
  const Icon = ICONS[kind]
  return <Icon {...props} />
}
