import {
  assertNativeCorrelation,
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
          if ('requestId' in event) {
            assertNativeCorrelation(event, options.requestId)
          }
          if ('result' in event && (!('type' in event) || event.type !== 'tool.result'))
            assertNativeCorrelation(event.result, options.requestId)
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
