import type { ProviderErrorDetails } from '@/providers/ai/types'

/** Safely describes failures and fills missing accounting, preserving explicit values and Error identity. */
export function toError(
  error: unknown,
  details?: ProviderErrorDetails
): Error & ProviderErrorDetails {
  let normalized: Error & ProviderErrorDetails
  if (error instanceof Error) {
    normalized = error
  } else {
    let message: string | undefined
    try {
      message = typeof error === 'string' ? error : JSON.stringify(error)
    } catch {
      // Circular values and BigInt cannot be serialized as JSON.
    }
    if (message === undefined) {
      try {
        message = String(error) || 'Unknown error'
      } catch {
        message = 'Unknown error'
      }
    }
    normalized = new Error(message)
  }
  const metadata = { ...details }
  for (const field of ['model', 'tokens', 'cost'] as const) {
    if (normalized[field] != null) delete metadata[field]
  }
  return Object.assign(normalized, metadata)
}
