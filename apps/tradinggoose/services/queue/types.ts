import { env } from '@/lib/env'

// Trigger types for rate limiting
export type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | 'api-endpoint'

// Rate limit counter types - which counter to increment in the database
export type RateLimitCounterType = 'sync' | 'async' | 'api-endpoint'

// Rate limit window duration in milliseconds
export const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.RATE_LIMIT_WINDOW_MS) || 60000

// Manual execution bypass value (effectively unlimited)
export const MANUAL_EXECUTION_LIMIT = Number.parseInt(env.MANUAL_EXECUTION_LIMIT) || 999999

// Custom error for rate limits
export class RateLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 429) {
    super(message)
    this.name = 'RateLimitError'
    this.statusCode = statusCode
  }
}
