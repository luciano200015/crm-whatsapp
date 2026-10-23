/**
 * How long the line's chatbot stays off in one chat: for a day (it comes
 * back on by itself) or until an agent turns it on again.
 */
export const BOT_PAUSES = ['24h', 'permanent'] as const;
export type BotPause = (typeof BOT_PAUSES)[number];

export const BOT_PAUSE_MS = 24 * 60 * 60_000;

/** When a pause that starts now ends; null: it does not end by itself. */
export function pauseEnd(pause: BotPause, now: Date): Date | null {
  return pause === 'permanent' ? null : new Date(now.getTime() + BOT_PAUSE_MS);
}

/** Whether the chatbot is off in the chat right now (a 24 h pause ends alone). */
export function isBotPaused(
  bot: { paused: boolean; pausedUntil?: Date | null } | null | undefined,
  now: Date,
): boolean {
  return !!bot?.paused && (!bot.pausedUntil || bot.pausedUntil > now);
}
