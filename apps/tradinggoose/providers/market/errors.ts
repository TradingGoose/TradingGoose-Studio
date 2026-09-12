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

/**
 * Shape of `TradingBrokerRequestError`, which the shared request helper throws
 * with the broker's HTTP status, URL and response payload attached.
 *
 * Detected structurally rather than by import: the market layer must not depend
 * on the trading layer, which is the cycle this provider already had to unwind.
 */
interface BrokerRequestErrorLike {
  message?: unknown
  status?: unknown
  providerId?: unknown
  url?: unknown
  payload?: unknown
}

const asBrokerRequestError = (error: unknown): BrokerRequestErrorLike | null => {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as BrokerRequestErrorLike
  if (typeof candidate.status !== 'number') return null
  if (typeof candidate.providerId !== 'string') return null
  return candidate
}

/**
 * A rejected credential or session needs an instruction, not a status code: the
 * IBKR Client Portal Gateway has no way to re-authenticate itself, so the only
 * remedy is a browser login at the gateway URL.
 */
const brokerFailureHint = (provider: string | undefined, status: number): string | undefined => {
  if (status !== 401 && status !== 403) return undefined
  if (provider === 'ibkr') {
    return (
      'The IBKR Client Portal Gateway session is not authenticated - log in at the ' +
      'gateway URL (default https://localhost:5001) and retry'
    )
  }
  return 'The broker rejected the credentials or session for this connection'
}

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

  const brokerError = asBrokerRequestError(error)
  if (brokerError) {
    const status = brokerError.status as number
    const providerId =
      typeof brokerError.providerId === 'string' ? brokerError.providerId : provider
    const baseMessage =
      (typeof brokerError.message === 'string' && brokerError.message.trim()) ||
      `Broker request failed with status ${status}`
    const hint = brokerFailureHint(providerId ?? provider, status)

    // Carry the broker's own status, URL and body through to the caller: the
    // generic message alone is what made a session lapse look like a provider
    // bug for an entire debugging session.
    return new MarketProviderError({
      code: 'PROVIDER ERROR',
      message: hint ? `${baseMessage}. ${hint}` : baseMessage,
      provider: providerId ?? provider,
      status,
      details: {
        brokerStatus: status,
        url: typeof brokerError.url === 'string' ? brokerError.url : undefined,
        payload: brokerError.payload,
      },
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
