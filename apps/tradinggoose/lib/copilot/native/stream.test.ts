import { expect, it } from 'vitest'
import type { CopilotEvent } from './contract'
import { readNativeEvents } from './stream'

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

const bytes = (parts: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
it('decodes split UTF8 and SSE frames in order', async () => {
  const events: CopilotEvent[] = [
    { type: 'text.delta', text: 'Hello🔥' },
    {
      type: 'response.completed',
      result: { status: 'completed', runId: 'run', threadId: 'thread', text: 'Hello🔥' },
    },
  ]
  const encoded = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
  )
  const parts = Array.from(encoded, (byte) => Uint8Array.of(byte))
  expect(await collect(readNativeEvents<CopilotEvent>(bytes(parts)))).toEqual(events)
})
it('rejects incomplete frames rather than treating partial text as completed work', async () => {
  await expect(
    collect(readNativeEvents(bytes([new TextEncoder().encode('data: {"type":"text.delta"}')])))
  ).rejects.toThrow('incomplete frame')
})
it('cancels the underlying read when its consumer aborts', async () => {
  const abort = new AbortController()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    },
  })
  const iterator = readNativeEvents(stream, { signal: abort.signal })
  const pending = iterator.next()
  abort.abort()
  await expect(pending).rejects.toThrow()
  expect(cancelled).toBe(true)
})
