import { encodeSSE } from '@/lib/utils'
import type { StreamingExecution } from '@/executor/types'

export function encodeProviderStream(result: StreamingExecution): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  return result.stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        if (text) controller.enqueue(encodeSSE({ type: 'text', text }))
      },
      flush(controller) {
        const text = decoder.decode()
        if (text) controller.enqueue(encodeSSE({ type: 'text', text }))
        const { checkpoint: _checkpoint, ...execution } = result.execution
        controller.enqueue(encodeSSE({ type: 'execution', execution }))
      },
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function decodeProviderStream(body: ReadableStream<Uint8Array>): StreamingExecution {
  const execution: StreamingExecution['execution'] = {
    success: true,
    output: {},
    logs: [],
    metadata: { duration: 0 },
  }
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let completed = false
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (completed || !frame.startsWith('data: ')) {
            throw new Error('Invalid provider stream frame')
          }
          const event: unknown = JSON.parse(frame.slice(6))
          if (!isRecord(event)) throw new Error('Invalid provider stream event')
          if (event.type === 'text' && typeof event.text === 'string') {
            controller.enqueue(encoder.encode(event.text))
          } else if (event.type === 'execution' && isRecord(event.execution)) {
            const final = event.execution
            if (
              typeof final.success !== 'boolean' ||
              !isRecord(final.output) ||
              (final.metadata !== undefined &&
                (!isRecord(final.metadata) || typeof final.metadata.duration !== 'number')) ||
              (final.logs !== undefined && !Array.isArray(final.logs))
            ) {
              throw new Error('Invalid provider stream execution data')
            }
            const { output, metadata, ...rest } = final
            Object.assign(execution.output, output)
            if (metadata) Object.assign(execution.metadata!, metadata)
            Object.assign(execution, rest)
            completed = true
            if (!execution.success) throw new Error(execution.error || 'Provider execution failed')
          } else {
            throw new Error('Invalid provider stream event')
          }
        }
      },
      flush() {
        buffer += decoder.decode()
        if (buffer || !completed)
          throw new Error('Provider stream ended without complete execution data')
      },
    })
  )
  return { stream, execution }
}
