import { describe, expect, it } from 'vitest'
import { muxOgg } from './ogg-opus'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** Splits an Ogg stream into its pages. */
function pages(file: Uint8Array) {
  const result: { flags: number; granule: bigint; sequence: number; body: Uint8Array }[] = []
  let offset = 0
  while (offset < file.length) {
    const view = new DataView(file.buffer, file.byteOffset + offset)
    expect(text(file.subarray(offset, offset + 4))).toBe('OggS')
    const segments = file[offset + 26]!
    const lacing = file.subarray(offset + 27, offset + 27 + segments)
    const size = lacing.reduce((sum, value) => sum + value, 0)
    const start = offset + 27 + segments
    result.push({
      flags: file[offset + 5]!,
      granule: view.getBigUint64(6, true),
      sequence: view.getUint32(18, true),
      body: file.subarray(start, start + size),
    })
    offset = start + size
  }
  return result
}

describe('muxOgg', () => {
  it('writes the Opus headers and pages a player can read', () => {
    const packets = Array.from({ length: 120 }, (_, i) => new Uint8Array(80).fill(i % 256))
    const file = muxOgg(packets, 312, 120 * 960 - 500)
    const all = pages(file)

    expect(text(all[0]!.body.subarray(0, 8))).toBe('OpusHead')
    expect(all[0]!.flags).toBe(0x02) // beginning of stream
    expect(text(all[1]!.body.subarray(0, 8))).toBe('OpusTags')
    // 120 packets in pages of 50: 50 + 50 + 20.
    expect(all.slice(2).map((page) => page.body.length)).toEqual([4000, 4000, 1600])
    expect(all.map((page) => page.sequence)).toEqual([0, 1, 2, 3, 4])
    expect(all.at(-1)!.flags).toBe(0x04) // end of stream
    // Last granule: pre-skip plus the real samples, trimming the padding.
    expect(all.at(-1)!.granule).toBe(BigInt(312 + 120 * 960 - 500))
  })

  it('splits packets of 255 bytes or more with lacing values', () => {
    const file = muxOgg([new Uint8Array(300)], 312, 960)
    const last = pages(file).at(-1)!
    expect(last.body.length).toBe(300)
  })
})
