import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatTimezoneLabel, parseUtcOffsetMinutes } from '@/lib/time-format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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

export function sanitizeRecord(
  record: Record<string, string> | null | undefined
): Record<string, string> {
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => key.trim().length > 0 && value.trim().length > 0
    )
  )
}
