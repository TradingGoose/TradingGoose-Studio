import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatTimezoneLabel, parseUtcOffsetMinutes } from '@/lib/time-format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function convertScheduleOptionsToCron(
  scheduleType: string,
  options: Record<string, string>
): string {
  switch (scheduleType) {
    case 'minutes': {
      const interval = options.minutesInterval || '15'
      // For example, if options.minutesStartingAt is provided, use that as the start minute.
      return `*/${interval} * * * *`
    }
    case 'hourly': {
      // When scheduling hourly, take the specified minute offset
      return `${options.hourlyMinute || '00'} * * * *`
    }
    case 'daily': {
      // Expected dailyTime in HH:mm or HH:mm:ss
      const [minute, hour] = (options.dailyTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} * * *`
    }
    case 'weekly': {
      // Expected weeklyDay as MON, TUE, etc. and weeklyDayTime in HH:mm or HH:mm:ss
      const dayMap: Record<string, number> = {
        MON: 1,
        TUE: 2,
        WED: 3,
        THU: 4,
        FRI: 5,
        SAT: 6,
        SUN: 0,
      }
      const day = dayMap[options.weeklyDay || 'MON']
      const [minute, hour] = (options.weeklyDayTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} * * ${day}`
    }
    case 'monthly': {
      // Expected monthlyDay and monthlyTime in HH:mm or HH:mm:ss
      const day = options.monthlyDay || '1'
      const [minute, hour] = (options.monthlyTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} ${day} * *`
    }
    case 'custom': {
      // Use the provided cron expression directly
      return options.cronExpression
    }
    default:
      throw new Error('Unsupported schedule type')
  }
}

/**
 * Format a date into a human-readable format
 * @param date - The date to format
 * @param utcOffset - Optional UTC offset string (e.g., '+02:00', '-07:00', 'UTC')
 * @returns A formatted date string in the format "MMM D, YYYY h:mm A"
 */
export function formatDateTime(date: Date, utcOffset?: string): string {
  if (!utcOffset) {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const offsetMinutes = parseUtcOffsetMinutes(utcOffset)
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000)
  const formattedDate = shifted.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })

  const tzLabel = formatTimezoneLabel(utcOffset)
  return tzLabel ? `${formattedDate} ${tzLabel}` : formattedDate
}

/**
 * Format a date into a short format
 * @param date - The date to format
 * @returns A formatted date string in the format "MMM D, YYYY"
 */
export function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format a time into a short format
 * @param date - The date to format
 * @returns A formatted time string in the format "h:mm A"
 */
export function formatTime(date: Date): string {
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format a duration in milliseconds to a human-readable format
 * @param durationMs - The duration in milliseconds
 * @returns A formatted duration string
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Generates a secure random password
 * @param length - The length of the password (default: 24)
 * @returns A new secure password string
 */
export function generatePassword(length = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
  let result = ''

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return result
}

/**
 * Recursively redacts API keys in an object
 * @param obj The object to redact API keys from
 * @returns A new object with API keys redacted
 */
export const redactApiKeys = (obj: any): any => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(redactApiKeys)
  }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (
      key.toLowerCase() === 'apikey' ||
      key.toLowerCase() === 'api_key' ||
      key.toLowerCase() === 'access_token' ||
      /\bsecret\b/i.test(key.toLowerCase()) ||
      /\bpassword\b/i.test(key.toLowerCase())
    ) {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Validates a name by removing any characters that could cause issues
 * with variable references or node naming.
 *
 * @param name - The name to validate
 * @returns The validated name with invalid characters removed, trimmed, and collapsed whitespace
 */
export function validateName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\s]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ') // Collapse multiple spaces into single spaces
}

/**
 * Checks if a name contains invalid characters
 *
 * @param name - The name to check
 * @returns True if the name is valid, false otherwise
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_\s]*$/.test(name)
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

/**
 * Encodes data as a Server-Sent Events (SSE) message.
 * Formats the data as a JSON string prefixed with "data:" and suffixed with two newlines,
 * then encodes it as a Uint8Array for streaming.
 *
 * @param data - The data to encode and send via SSE
 * @returns The encoded SSE message as a Uint8Array
 */
export function encodeSSE(data: any): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * Gets a list of invalid characters in a name
 *
 * @param name - The name to check
 * @returns Array of invalid characters found
 */
export function getInvalidCharacters(name: string): string[] {
  const invalidChars = name.match(/[^a-zA-Z0-9_\s]/g)
  return invalidChars ? [...new Set(invalidChars)] : []
}

/**
 * Generate a short request ID for correlation
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * No-operation function for use as default callback
 */
export const noop = () => {}

/**
 * Escapes special regex characters in a string so it can be used
 * as a literal in `new RegExp(...)`.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash
}

/**
 * Derive a deterministic HSL color string from a user id.
 * Used for collaborative presence avatars and cursors.
 */
export function deriveUserColor(userId: string): string {
  return `hsl(${Math.abs(hashString(userId)) % 360}, 70%, 50%)`
}

export function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function sanitizeRecord(record: Record<string, string> | null | undefined): Record<string, string> {
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
  )
}
