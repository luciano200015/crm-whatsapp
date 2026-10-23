/**
 * Opening hours of a chatbot (or of a "Horario de atención" node): days of
 * the week with time ranges, in an IANA time zone.
 */
export interface ScheduleRange {
  /** "HH:MM", 24 h. */
  from: string;
  /** "HH:MM", 24 h; "24:00" reaches the end of the day. */
  to: string;
}

export interface ScheduleDay {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  ranges: ScheduleRange[];
}

export interface Schedule {
  timezone: string;
  days: ScheduleDay[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const minutes = (time: string) => {
  const [hours, mins] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0);
};

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Why a schedule is not valid, or null. */
export function scheduleProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'Horario inválido';
  const schedule = value as Partial<Schedule>;
  if (typeof schedule.timezone !== 'string' || !isTimeZone(schedule.timezone))
    return 'Zona horaria inválida';
  if (!Array.isArray(schedule.days) || schedule.days.length > 7)
    return 'Días inválidos';
  const seen = new Set<number>();
  for (const day of schedule.days as unknown[]) {
    const entry = day as Partial<ScheduleDay>;
    if (
      typeof entry?.day !== 'number' ||
      !Number.isInteger(entry.day) ||
      entry.day < 0 ||
      entry.day > 6 ||
      seen.has(entry.day)
    )
      return 'Días inválidos';
    seen.add(entry.day);
    if (!Array.isArray(entry.ranges) || entry.ranges.length > 6)
      return 'Rangos inválidos';
    for (const range of entry.ranges as unknown[]) {
      const r = range as Partial<ScheduleRange>;
      if (
        typeof r?.from !== 'string' ||
        typeof r.to !== 'string' ||
        !TIME.test(r.from) ||
        !TIME.test(r.to) ||
        minutes(r.from) >= minutes(r.to)
      )
        return 'Cada rango debe ir de una hora menor a una mayor (HH:MM)';
    }
  }
  return null;
}

/** Day of the week (0-6) and minutes since midnight at `now` in the zone. */
function localTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAYS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Whether `now` falls inside the schedule. No schedule: always open. */
export function withinSchedule(
  schedule: Schedule | null | undefined,
  now: Date,
): boolean {
  if (!schedule) return true;
  const local = localTime(now, schedule.timezone);
  const today = schedule.days.find((day) => day.day === local.day);
  return (
    today?.ranges.some(
      (range) =>
        local.minutes >= minutes(range.from) &&
        local.minutes < minutes(range.to),
    ) ?? false
  );
}
