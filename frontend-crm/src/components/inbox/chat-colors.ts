import { useColorScheme } from '@mui/material/styles'

/** WhatsApp-like colors for the chat, in light and dark mode. */
export function useChatColors() {
  // With CSS variables the theme object stays "light": ask the color scheme instead.
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'
  return dark
    ? {
        wallpaper: '#0b141a',
        pattern: 'rgba(255,255,255,0.035)',
        incoming: '#202c33',
        outgoing: '#005c4b',
        note: '#4a3f12',
        notice: '#182229',
        noticeText: '#8696a0',
        meta: 'rgba(233,237,239,0.6)',
        read: '#53bdeb',
        unread: '#00a884',
        selected: 'rgba(255,255,255,0.08)',
        agent: '#06cf9c',
      }
    : {
        wallpaper: '#efeae2',
        pattern: 'rgba(0,0,0,0.035)',
        incoming: '#ffffff',
        outgoing: '#d9fdd3',
        note: '#fff3c4',
        notice: '#ffffff',
        noticeText: '#54656f',
        meta: 'rgba(17,27,33,0.55)',
        read: '#53bdeb',
        unread: '#25d366',
        selected: '#f0f2f5',
        agent: '#008069',
      }
}

export type ChatColors = ReturnType<typeof useChatColors>
