import { EventSourceParserStream } from '@ai-sdk/provider-utils'

export function waitToReconnect(signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

/** Decode SSE data separately from JSON so consumers can distinguish transport failures. */
export async function* readSseData(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal } = {}
): AsyncGenerator<string, void> {
  const reader = stream
    .pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
    .pipeThrough(new EventSourceParserStream())
    .getReader()
  const abort = () => {
    void reader.cancel(options.signal?.reason).catch(() => {})
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      options.signal?.throwIfAborted()
      if (done) return
      if (value.data && value.data !== '[DONE]') yield value.data
    }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
