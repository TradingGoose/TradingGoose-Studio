export type MarketProviderErrorCode =
  | 'EMPTY SERIES'
  | 'INVALID REQUEST'
  | 'UNSUPPORTED PROVIDER'
  | 'PROVIDER ERROR'
  | 'LISTING RESOLVE FAILED'

export type MarketProviderErrorDetails = {
  code: MarketProviderErrorCode
  message: string
  provider?: string
  status?: number
  details?: unknown
}

export class MarketProviderError extends Error {
  code: MarketProviderErrorCode
  provider?: string
  status?: number
  details?: unknown

  constructor({ code, message, provider, status, details }: MarketProviderErrorDetails) {
    super(message)
    this.name = 'MarketProviderError'
    this.code = code
    this.provider = provider
    this.status = status
    this.details = details
  }
}

export const isMarketProviderError = (error: unknown): error is MarketProviderError =>
  error instanceof MarketProviderError ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    (error as { code?: unknown }).code !== undefined)

export const normalizeMarketProviderError = (
  error: unknown,
  provider?: string
): MarketProviderError => {
  if (isMarketProviderError(error)) {
    const typed = error as MarketProviderError
    return new MarketProviderError({
      code: typed.code,
      message: typed.message,
      provider: typed.provider ?? provider,
      status: typed.status,
      details: typed.details,
    })
  }

  if (error instanceof Error) {
    return new MarketProviderError({
      code: 'PROVIDER ERROR',
      message: error.message || 'Market provider error',
      provider,
    })
  }

  return new MarketProviderError({
    code: 'PROVIDER ERROR',
    message: 'Market provider error',
    provider,
  })
}
