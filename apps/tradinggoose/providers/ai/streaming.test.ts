import { expect, it, vi } from 'vitest'
import { decodeProviderStream, encodeProviderStream } from '@/providers/ai/streaming'

const execution = {
  success: true,
  output: { content: '価格📈' },
  logs: [],
  metadata: { duration: 1 },
}
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
const final = frame({ type: 'execution', execution })

it('preserves split UTF-8 text and split HTTP frames', async () => {
  const bytes = new TextEncoder().encode(execution.output.content)
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  const wire = encodeProviderStream({ stream: source, execution }).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const byte of chunk) controller.enqueue(Uint8Array.of(byte))
      },
    })
  )
  const result = decodeProviderStream(wire)
  expect(await new Response(result.stream).text()).toBe(execution.output.content)
  expect(result.execution).toEqual(execution)
})

it('accepts execution data with optional logs and metadata omitted', async () => {
  const result = decodeProviderStream(
    new Response(
      frame({
        type: 'execution',
        execution: { success: true, output: { content: 'Done' } },
      })
    ).body!
  )
  await new Response(result.stream).text()
  expect(result.execution).toEqual({
    success: true,
    output: { content: 'Done' },
    logs: [],
    metadata: { duration: 0 },
  })
})

it.each([
  '',
  'data: invalid\n\n',
  frame({ type: 'unknown' }),
  frame({ type: 'text', text: 123 }),
  frame({ type: 'text', text: 'Partial' }),
  frame({ type: 'execution', execution: {} }),
  frame({ type: 'execution', execution: { ...execution, success: false, error: 'Failed' } }),
  `${final}${frame({ type: 'text', text: 'Late' })}`,
  `${final}${final}`,
  `${final}data:`,
])('rejects malformed, failed, or incomplete provider streams: %j', async (wire) => {
  const result = decodeProviderStream(new Response(wire).body!)
  await expect(new Response(result.stream).text()).rejects.toThrow()
})

it.each(['error', 'cancel'])('propagates source %s through the HTTP codec', async (operation) => {
  const cancel = vi.fn()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const source = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel,
  })
  const result = decodeProviderStream(encodeProviderStream({ stream: source, execution }))
  if (operation === 'error') {
    controller.error(new Error('Provider failed'))
    await expect(new Response(result.stream).text()).rejects.toThrow('Provider failed')
  } else {
    await result.stream.cancel('Cancelled')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith('Cancelled'))
  }
})
