export class TradingServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TradingServiceError'
    this.status = status
  }
}

export const isTradingServiceError = (error: unknown): error is TradingServiceError =>
  error instanceof TradingServiceError
