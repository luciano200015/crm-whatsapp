import { describe, expect, it } from 'vitest'
import { readEvents } from './event-stream'

describe('SSE parsing', () => {
  it('handles split UTF-8 characters, CRLF boundaries and multiple events', async () => {
    const bytes = new TextEncoder().encode(
      'event: message.created\r\ndata: {"text":"¡Hola!"}\r\n\r\nevent: ping\ndata: {}\n\n',
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    const received: unknown[] = []
    await readEvents(stream, new AbortController().signal, (type, data) =>
      received.push({ type, data }),
    )
    expect(received).toEqual([
      { type: 'message.created', data: { text: '¡Hola!' } },
      { type: 'ping', data: {} },
    ])
  })

  it('cancels a pending read on logout or workspace change', async () => {
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
    })
    const controller = new AbortController()
    const task = readEvents(stream, controller.signal, () => {
      throw new Error('Unexpected event')
    })
    controller.abort()
    await task
    expect(canceled).toBe(true)
  })
})
