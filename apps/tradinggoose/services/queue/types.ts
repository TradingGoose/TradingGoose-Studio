// Trigger types for rate limiting
export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'api-endpoint'

// Rate limit counter types - which counter to increment in the database
export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'

// Custom error for rate limits
export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
