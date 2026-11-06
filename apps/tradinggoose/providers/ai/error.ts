import type { ProviderErrorDetails } from '@/providers/ai/types'

/** Normalizes failures, filling missing accounting while preserving explicit values and error identity. */
export function toError(
  error: unknown,
  details?: ProviderErrorDetails
): Error & ProviderErrorDetails {
  const normalized: Error & ProviderErrorDetails =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  const metadata = { ...details }
  for (const field of ['model', 'tokens', 'cost'] as const) {
    if (normalized[field] != null) delete metadata[field]
  }
  return Object.assign(normalized, metadata)
}
