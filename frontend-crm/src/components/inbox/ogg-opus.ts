/**
 * Voice notes as OGG/Opus, the format of WhatsApp voice messages.
 *
 * Chrome records MP4 (fragmented) or WebM, which Meta rejects ("Media file
 * scrutiny … failed"). The recording is decoded, encoded to Opus with
 * WebCodecs (AudioEncoder) and wrapped in an Ogg container (RFC 7845).
 */

const SAMPLE_RATE = 48_000
/** 20 ms at 48 kHz: one Opus packet. */
const FRAME = 960
/** Usual encoder delay of libopus at 48 kHz (used when the encoder does not tell). */
const DEFAULT_PRE_SKIP = 312
/** About one second of audio per Ogg page. */
const PACKETS_PER_PAGE = 50

export const canEncodeOpus = () =>
  typeof AudioEncoder !== 'undefined' &&
  typeof AudioData !== 'undefined' &&
  typeof OfflineAudioContext !== 'undefined'

/** Mono PCM at 48 kHz from any recording the browser can decode. */
async function decodeMono(recording: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  // decodeAudioData resamples to the context rate.
  const audio = await context.decodeAudioData(await recording.arrayBuffer())
  const mono = new Float32Array(audio.length)
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel)
    for (let i = 0; i < data.length; i++)
      mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / audio.numberOfChannels
  }
  return mono
}

async function encodeOpus(pcm: Float32Array): Promise<{ packets: Uint8Array[]; preSkip: number }> {
  const packets: Uint8Array[] = []
  let preSkip = DEFAULT_PRE_SKIP
  let failure: unknown = null
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const packet = new Uint8Array(chunk.byteLength)
      chunk.copyTo(packet)
      packets.push(packet)
      // When the encoder shares its OpusHead, take the real pre-skip from it.
      const description = metadata?.decoderConfig?.description
      if (description && description.byteLength >= 12) {
        const bytes = ArrayBuffer.isView(description)
          ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
          : new Uint8Array(description)
        preSkip = bytes[10]! | (bytes[11]! << 8)
      }
    },
    error: (error) => {
      failure = error
    },
  })
  encoder.configure({
    codec: 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: 32_000,
  })
  for (let offset = 0; offset < pcm.length; offset += FRAME) {
    const slice = pcm.slice(offset, Math.min(offset + FRAME, pcm.length))
    const data = new AudioData({
      format: 'f32',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      numberOfFrames: slice.length,
      timestamp: Math.round((offset / SAMPLE_RATE) * 1_000_000),
      data: slice,
    })
    encoder.encode(data)
    data.close()
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure instanceof Error ? failure : new Error('Opus encoding failed')
  return { packets, preSkip }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i << 24
    for (let bit = 0; bit < 8; bit++) {
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0
  return crc
}

const SERIAL = 0x4352_4d31 // "CRM1"

function oggPage(packets: Uint8Array[], granule: number, sequence: number, flags: number) {
  const lacing: number[] = []
  for (const packet of packets) {
    let size = packet.length
    while (size >= 255) {
      lacing.push(255)
      size -= 255
    }
    lacing.push(size)
  }
  const bodyLength = packets.reduce((sum, packet) => sum + packet.length, 0)
  const page = new Uint8Array(27 + lacing.length + bodyLength)
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53]) // "OggS"
  page[4] = 0 // version
  page[5] = flags
  view.setBigUint64(6, BigInt(granule), true)
  view.setUint32(14, SERIAL, true)
  view.setUint32(18, sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = 27 + lacing.length
  for (const packet of packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  view.setUint32(22, oggCrc(page), true)
  return page
}

const ascii = (text: string) => new TextEncoder().encode(text)

function opusHead(preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set(ascii('OpusHead'))
  head[8] = 1 // version
  head[9] = 1 // mono
  view.setUint16(10, preSkip, true)
  view.setUint32(12, SAMPLE_RATE, true)
  view.setInt16(16, 0, true) // output gain
  head[18] = 0 // channel mapping family
  return head
}

function opusTags(): Uint8Array {
  const vendor = ascii('crm')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  const view = new DataView(tags.buffer)
  tags.set(ascii('OpusTags'))
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  view.setUint32(12 + vendor.length, 0, true) // no user comments
  return tags
}

/** Ogg container with the Opus headers and the audio packets (RFC 7845). */
export function muxOgg(packets: Uint8Array[], preSkip: number, samples: number): Uint8Array {
  const pages = [oggPage([opusHead(preSkip)], 0, 0, 0x02), oggPage([opusTags()], 0, 1, 0)]
  const total = preSkip + samples
  for (let start = 0; start < packets.length; start += PACKETS_PER_PAGE) {
    const group = packets.slice(start, start + PACKETS_PER_PAGE)
    const last = start + PACKETS_PER_PAGE >= packets.length
    // Granule: samples up to the end of the page, counting the pre-skip;
    // the last page trims the encoder padding.
    const granule = Math.min((start + group.length) * FRAME, last ? total : Infinity)
    pages.push(oggPage(group, granule, pages.length, last ? 0x04 : 0))
  }
  const size = pages.reduce((sum, page) => sum + page.length, 0)
  const file = new Uint8Array(size)
  let offset = 0
  for (const page of pages) {
    file.set(page, offset)
    offset += page.length
  }
  return file
}

/** Any browser recording → an OGG/Opus voice note WhatsApp accepts. */
export async function toOggOpus(recording: Blob): Promise<Blob> {
  const pcm = await decodeMono(recording)
  const { packets, preSkip } = await encodeOpus(pcm)
  const ogg = muxOgg(packets, preSkip, pcm.length)
  return new Blob([ogg.buffer as ArrayBuffer], { type: 'audio/ogg' })
}
