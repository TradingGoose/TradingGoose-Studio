import { EventSourceParserStream } from '@ai-sdk/provider-utils'
import type { CompletionEvent, CopilotEvent } from './contract'

/** Decode complete SSE frames from the built-in service. */
export async function* readNativeEvents<T extends CopilotEvent | CompletionEvent = CopilotEvent>(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal } = {}
): AsyncGenerator<T> {
  const reader = stream
    .pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
    .pipeThrough(new EventSourceParserStream())
    .getReader()
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
      if (done) {
        ended = true
        break
      }
      if (value.data) yield JSON.parse(value.data) as T
    }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    if (!ended) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
