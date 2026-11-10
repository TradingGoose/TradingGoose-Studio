import type { ChunkType } from '@mastra/core/stream'
import { safeInferenceError } from '@/lib/mastra/errors'

export type ProductModelEvent =
  | { type: 'text-delta' | 'reasoning-delta'; payload: { text: string } }
  | { type: 'tool-call'; payload: { toolCallId: string; toolName: string; args?: unknown } }
  | {
      type: 'tool-result'
      payload: { toolCallId: string; toolName: string; result: unknown; isError?: boolean }
    }
  | { type: 'error'; payload: { error: string } }
  | { type: 'tool-error'; payload: { toolCallId: string; toolName: string; error: string } }
  | { type: 'abort'; payload: Record<string, never> }

/** SDK-reserved top-level metadata is not business data; nested business fields remain exact. */
function productToolValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '__mastraMetadata'))
}

/** Project the supported product stream; raw native envelopes can contain prompts and headers. */
export function projectNativeModelEvent<T>(
  event: ChunkType<T>,
  apiKey?: string
): ProductModelEvent | null {
  switch (event.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return { type: event.type, payload: { text: event.payload.text } }
    case 'tool-call':
      return {
        type: event.type,
        payload: {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          ...(event.payload.args === undefined
            ? {}
            : { args: productToolValue(event.payload.args) }),
        },
      }
    case 'tool-result':
      return {
        type: event.type,
        payload: {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          result: event.payload.isError
            ? { error: safeInferenceError(event.payload.result, apiKey) }
            : productToolValue(event.payload.result),
          ...(event.payload.isError === undefined ? {} : { isError: event.payload.isError }),
        },
      }
    case 'tool-error':
      return {
        type: event.type,
        payload: {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          error: safeInferenceError(event.payload.error, apiKey),
        },
      }
    case 'error':
      return {
        type: event.type,
        payload: { error: safeInferenceError(event.payload.error, apiKey) },
      }
    case 'abort':
      return { type: event.type, payload: {} }
    default:
      return null
  }
}
