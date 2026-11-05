import type { ProviderErrorDetails } from '@/providers/ai/types'

/** Normalizes thrown values while preserving errors and any completed provider usage. */
export function toError(
  error: unknown,
  details?: ProviderErrorDetails
): Error & ProviderErrorDetails {
  return Object.assign(
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error)),
    details
  )
}
