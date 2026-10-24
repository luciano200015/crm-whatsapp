import type { Conversation } from '../../lib/api/inbox'

type Bot = NonNullable<Conversation['bot']>

/** Off in this chat; a 24 h pause that already ran out counts as on again. */
export function botPaused(bot: Bot | undefined, now = Date.now()): boolean {
  if (!bot || bot.state !== 'paused') return false
  return !bot.pausedUntil || Date.parse(bot.pausedUntil) > now
}

/** "5 h 12 min", "12 min": what is left of a pause. */
export function timeLeft(until: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export type BotChoice = '24h' | 'permanent' | 'resume'

/** What the chat menu (⋮) offers for the bot. */
export const BOT_CHOICES: Record<BotChoice, string> = {
  '24h': 'Desactivar bot por 24 horas',
  permanent: 'Desactivar bot permanentemente',
  resume: 'Activar bot',
}

/** On: off for a day or for good. Off for a day: on again, or for good. Off for good: on again. */
export function botChoices(bot: Bot, now = Date.now()): BotChoice[] {
  if (!botPaused(bot, now)) return ['24h', 'permanent']
  return bot.pausedUntil ? ['resume', 'permanent'] : ['resume']
}

/** "Bot desactivado por 24 horas · vuelve en 5 h 12 min" or "… permanentemente". */
export function botPauseText(bot: Bot, now = Date.now()): string {
  const who = bot.pausedBy ? ` por ${bot.pausedBy.name}` : ''
  return bot.pausedUntil
    ? `Bot desactivado por 24 horas${who} · vuelve en ${timeLeft(bot.pausedUntil, now)}`
    : `Bot desactivado permanentemente${who}`
}
