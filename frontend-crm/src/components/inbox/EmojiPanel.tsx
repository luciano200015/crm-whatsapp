import EmojiPicker, { Categories, EmojiStyle, Theme } from 'emoji-picker-react'

const CATEGORIES = [
  { category: Categories.SUGGESTED, name: 'Usados recientemente' },
  { category: Categories.SMILEYS_PEOPLE, name: 'Caras y personas' },
  { category: Categories.ANIMALS_NATURE, name: 'Animales y naturaleza' },
  { category: Categories.FOOD_DRINK, name: 'Comida y bebida' },
  { category: Categories.TRAVEL_PLACES, name: 'Viajes y lugares' },
  { category: Categories.ACTIVITIES, name: 'Actividades' },
  { category: Categories.OBJECTS, name: 'Objetos' },
  { category: Categories.SYMBOLS, name: 'Símbolos' },
  { category: Categories.FLAGS, name: 'Banderas' },
]

/**
 * Emoji picker of the composer, loaded only when opened. Native emojis: what
 * WhatsApp sends is the character itself, and nothing loads from a CDN.
 */
export default function EmojiPanel({
  dark,
  onPick,
}: {
  dark: boolean
  onPick: (emoji: string) => void
}) {
  return (
    <EmojiPicker
      onEmojiClick={(data) => onPick(data.emoji)}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      categories={CATEGORIES}
      searchPlaceholder="Buscar emoji"
      previewConfig={{ showPreview: false }}
      lazyLoadEmojis
      width={320}
      height={380}
    />
  )
}
