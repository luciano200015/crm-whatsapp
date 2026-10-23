import AddRounded from '@mui/icons-material/AddRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import {
  Autocomplete,
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { es } from '../../i18n/es'
import type { Schedule } from '../../lib/api/chatbots'

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()

/** Monday first, as people read a week. */
const ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Days of the week with time ranges, in a time zone. */
export function ScheduleEditor({
  value,
  onChange,
}: {
  value: Schedule
  onChange: (schedule: Schedule) => void
}) {
  const t = es.chatbots.schedule
  const dayOf = (day: number) => value.days.find((entry) => entry.day === day)
  const setRanges = (day: number, ranges: Schedule['days'][number]['ranges']) => {
    const others = value.days.filter((entry) => entry.day !== day)
    onChange({
      ...value,
      days: ranges.length > 0 ? [...others, { day, ranges }].sort((a, b) => a.day - b.day) : others,
    })
  }
  return (
    <Stack spacing={1.5}>
      <Autocomplete
        size="small"
        options={ZONES}
        value={value.timezone}
        disableClearable
        onChange={(_, timezone) => onChange({ ...value, timezone })}
        renderInput={(props) => <TextField {...props} label={t.timezone} />}
      />
      {ORDER.map((day) => {
        const entry = dayOf(day)
        const open = !!entry && entry.ranges.length > 0
        return (
          <Box key={day}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <FormControlLabel
                sx={{ minWidth: 130 }}
                control={
                  <Checkbox
                    size="small"
                    checked={open}
                    onChange={(event) =>
                      setRanges(day, event.target.checked ? [{ from: '09:00', to: '18:00' }] : [])
                    }
                  />
                }
                label={t.days[day]}
              />
              {!open && (
                <Typography variant="body2" color="text.secondary">
                  {t.closed}
                </Typography>
              )}
            </Stack>
            {open && (
              <Stack spacing={1} sx={{ pl: 4 }}>
                {entry.ranges.map((range, index) => (
                  <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {(['from', 'to'] as const).map((key) => (
                      <TextField
                        key={key}
                        size="small"
                        type="time"
                        label={key === 'from' ? t.from : t.to}
                        value={range[key]}
                        onChange={(event) =>
                          setRanges(
                            day,
                            entry.ranges.map((item, position) =>
                              position === index ? { ...item, [key]: event.target.value } : item,
                            ),
                          )
                        }
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: {
                            'aria-label': `${t.days[day]} ${key === 'from' ? t.from : t.to} ${index + 1}`,
                          },
                        }}
                        sx={{ width: 130 }}
                      />
                    ))}
                    <Tooltip title={t.removeRange}>
                      <IconButton
                        size="small"
                        aria-label={t.removeRange}
                        onClick={() =>
                          setRanges(
                            day,
                            entry.ranges.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <CloseRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
                {entry.ranges.length < 6 && (
                  <Box>
                    <IconButton
                      size="small"
                      aria-label={`${t.addRange}: ${t.days[day]}`}
                      onClick={() =>
                        setRanges(day, [...entry.ranges, { from: '14:00', to: '18:00' }])
                      }
                    >
                      <AddRounded fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Stack>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}
