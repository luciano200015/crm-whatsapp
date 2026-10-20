import Chip, { type ChipProps } from '@mui/material/Chip'
import { alpha } from '@mui/material/styles'
import type { TagSummary } from '../../lib/api/types'

/** A tag in its own color (tinted background, colored border and text). */
export function TagChip({ tag, ...props }: { tag: TagSummary } & Omit<ChipProps, 'label'>) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={tag.name}
      {...props}
      sx={[
        {
          borderColor: tag.color,
          color: tag.color,
          bgcolor: alpha(tag.color, 0.12),
          fontWeight: 600,
          '& .MuiChip-deleteIcon': { color: alpha(tag.color, 0.7) },
        },
        ...(Array.isArray(props.sx) ? props.sx : props.sx ? [props.sx] : []),
      ]}
    />
  )
}
