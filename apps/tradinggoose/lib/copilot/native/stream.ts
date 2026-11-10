import {
  assertNativeCommandResponse,
  assertNativeCorrelation,
  type CopilotEvent,
  type CopilotRequest,
  NativeCommandResponseError,
  type NativeContractDefinitions,
  parseNativeContract,
} from './contract'

/** Decode complete SSE frames; validate closed product events rather than forwarding upstream envelopes. */
export async function* readNativeEvents<K extends 'CopilotEvent' | 'CompletionEvent'>(
  stream: ReadableStream<Uint8Array>,
  definition: K,
  options: { requestId: string; signal?: AbortSignal }
): AsyncGenerator<NativeContractDefinitions[K]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let ended = false
  const abort = () => {
    void reader.cancel(options.signal?.reason).catch(() => {})
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      options.signal?.throwIfAborted()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let separator = /\r?\n\r?\n/.exec(buffer)
      while (separator) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (data) {
          const event = await parseNativeContract(definition, JSON.parse(data))
          if ('protocolRevision' in event && 'requestId' in event) {
            assertNativeCorrelation(event, options.requestId)
          }
          if ('result' in event) assertNativeCorrelation(event.result, options.requestId)
          yield event
        }
        separator = /\r?\n\r?\n/.exec(buffer)
      }
      if (done) {
        ended = true
        if (buffer.trim()) throw new Error('Native Copilot stream ended with an incomplete frame')
        break
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    if (!ended) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Reader-driven relay keeps upstream work bounded by actual downstream demand. */
export function relayNativeEvents<K extends 'CopilotEvent' | 'CompletionEvent'>(
  upstream: ReadableStream<Uint8Array>,
  definition: K,
  options: {
    requestId: string
    signal?: AbortSignal
    command?: CopilotRequest['command']
    abortUpstream: () => void
  }
) {
  if (definition === 'CopilotEvent' && options.command === undefined)
    throw new Error('A Copilot relay requires its actual native command')
  const cancellation = new AbortController()
  const abort = () => cancellation.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const stop = () => {
    cancellation.abort()
    options.abortUpstream()
    options.signal?.removeEventListener('abort', abort)
  }
  const events = readNativeEvents(upstream, definition, {
    requestId: options.requestId,
    signal: cancellation.signal,
  })
  const encoder = new TextEncoder()
  let terminal = false
  let started = false
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          started = true
          const next = await events.next()
          if (next.done) {
            if (!terminal) throw new Error('Native Copilot stream ended without a terminal outcome')
            options.signal?.removeEventListener('abort', abort)
            controller.close()
            return
          }
          if (terminal) throw new Error('Native Copilot emitted data after its terminal outcome')
          const event = next.value
          if ('type' in event && 'result' in event && options.command !== undefined)
            assertNativeCommandResponse(options.command, event.result)
          terminal =
            'type' in event
              ? [
                  'response.completed',
                  'response.suspended',
                  'response.refused',
                  'response.error',
                  'response.cancel_requested',
                  'context.compacted',
                ].includes(event.type)
              : 'done' in event || 'error' in event || 'cancelled' in event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch (error) {
          stop()
          await events.return(undefined)
          if (!terminal && error instanceof NativeCommandResponseError) {
            const outcome = error.nativeOutcome
            const failed: CopilotEvent = {
              type: 'response.error',
              protocolRevision: outcome.protocolRevision,
              requestId: outcome.requestId,
              result: outcome,
            }
            terminal = true
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(failed)}\n\n`))
            controller.close()
            return
          }
          controller.error(error)
        }
      },
      async cancel() {
        stop()
        if (!started) await upstream.cancel()
        await events.return(undefined)
      },
    },
    { highWaterMark: 0 }
  )
}
