import { expect, it } from 'vitest'
import { readSseData } from './stream'

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
  const events = ['{"text":"Hello🔥"}', '{"complete":true}']
  const encoded = new TextEncoder().encode(
    [...events, '[DONE]'].map((event) => `data: ${event}\r\n\r\n`).join('')
  )
  const parts = Array.from(encoded, (byte) => Uint8Array.of(byte))
  expect(await collect(readSseData(bytes(parts)))).toEqual(events)
})
it('does not dispatch an incomplete SSE frame', async () => {
  expect(
    await collect(readSseData(bytes([new TextEncoder().encode('data: {"type":"text.delta"}')])))
  ).toEqual([])
})
it('cancels the underlying read when its consumer aborts', async () => {
  const abort = new AbortController()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    },
  })
  const iterator = readSseData(stream, { signal: abort.signal })
  const pending = iterator.next()
  abort.abort()
  await expect(pending).rejects.toThrow()
  expect(cancelled).toBe(true)
})
