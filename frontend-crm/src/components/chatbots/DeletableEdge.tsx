import CloseRounded from '@mui/icons-material/CloseRounded'
import { IconButton, Tooltip } from '@mui/material'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { useState } from 'react'
import { es } from '../../i18n/es'

/**
 * A connection between two cards with an ✕ in the middle to remove it,
 * without deleting either card (also: click it and press Supr).
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [hover, setHover] = useState(false)
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const active = hover || selected
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={0}
        style={{ ...style, strokeWidth: active ? 3 : 2 }}
      />
      {/* A wide invisible path, so hovering the line shows the ✕. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <Tooltip title={es.chatbots.editor.removeEdge}>
          <IconButton
            size="small"
            aria-label={es.chatbots.editor.removeEdge}
            className="nodrag nopan"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(event) => {
              event.stopPropagation()
              void deleteElements({ edges: [{ id }] })
            }}
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              width: 20,
              height: 20,
              p: 0,
              bgcolor: active ? 'error.main' : 'background.paper',
              color: active ? 'common.white' : 'text.secondary',
              border: 1,
              borderColor: active ? 'error.main' : 'divider',
              opacity: active ? 1 : 0.75,
              '&:hover': { bgcolor: 'error.dark', color: 'common.white' },
            }}
          >
            <CloseRounded sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </EdgeLabelRenderer>
    </>
  )
}
