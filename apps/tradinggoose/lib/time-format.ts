export type TimeFormat = 'date' | 'time' | 'datetime' | 'seconds' | 'family'

const OFFSET_RE = /^[+-]\d{2}:\d{2}$/

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const SECONDS_RE = /^\d+$/

const DATE_HINT_RE = /yyyy-mm-dd|\d{4}-\d{2}-\d{2}/i
const TIME_HINT_RE = /hh:mm:ss|hh:mm|\d{2}:\d{2}/i
const DATETIME_HINT_RE = /t\d{2}:\d{2}|iso 8601|date\s*&\s*time|date\/time/i
const SECONDS_HINT_RE = /unix|epoch|timestamp|milliseconds|\bms\b|\bsecs?\b|\bseconds?\b/i
const DURATION_HINT_RE = /duration|timeout|wait|delay|minutes?|hours?|days?|weeks?|months?|years?/i
const RELATIVE_TIME_HINT_RE = /relative\s*time|now[-+]\d+|\bago\b|from\s+now/i
const DURATION_STRING_HINT_RE = /\b\d+\s*(ms|s|m|h|d|w|y)\b/i
const TIME_RELATED_HINT_RE = /date|time|timestamp|datetime|timezone|cron|interval/i
const EXCLUDE_HINT_RE = /time\s*in\s*force|time[_-]?range|time\s*range/i

const pad2 = (value: number) => value.toString().padStart(2, '0')

export const isUtcOffset = (value: string) => value === 'UTC' || OFFSET_RE.test(value)

export const normalizeUtcOffset = (value: string) => (value === 'UTC' ? '+00:00' : value)

export const formatTimezoneLabel = (value?: string | null) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isUtcOffset(trimmed)) {
    const normalized = normalizeUtcOffset(trimmed)
    return normalized === '+00:00' ? 'UTC' : `UTC${normalized}`
  }
  return trimmed
}

export const parseUtcOffsetMinutes = (value: string) => {
  const normalized = normalizeUtcOffset(value)
  if (!OFFSET_RE.test(normalized)) {
    throw new Error(`Invalid UTC offset: ${value}`)
  }
  const sign = normalized.startsWith('-') ? -1 : 1
  const [hours, minutes] = normalized.slice(1).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid UTC offset: ${value}`)
  }
  return sign * (hours * 60 + minutes)
}

const isValidDate = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const isValidTime = (hours: number, minutes: number, seconds: number) => {
  if (hours < 0 || hours > 23) return false
  if (minutes < 0 || minutes > 59) return false
  if (seconds < 0 || seconds > 59) return false
  return true
}

export const formatUtcDateTime = (date: Date): string =>
  date.toISOString().replace(/\.\d{3}Z$/, 'Z')

export const formatUtcDate = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`

export const resolveStoredDateValue = (raw: unknown): Date | undefined => {
  if (!raw) return undefined
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw
  if (typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      if (!Number.isNaN(numeric)) {
        const ms = trimmed.length <= 10 ? numeric * 1000 : numeric
        const date = new Date(ms)
        return Number.isNaN(date.getTime()) ? undefined : date
      }
    }
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

export const parseStoredTimeValue = (raw: string | null | undefined): Date => {
  const now = new Date()
  if (!raw) return now
  const [hours, minutes, seconds] = raw.split(':')
  const hour = Number.parseInt(hours, 10)
  const minute = Number.parseInt(minutes, 10)
  const second = Number.parseInt(seconds ?? '0', 10)
  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return now
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    second,
    0
  )
}

export const shouldSkipTimeValidation = (value: string): boolean => {
  if (!value) return true
  return /<[^>]*>/.test(value) || /\{\{[^}]*\}\}/.test(value)
}

export const normalizeTimeInput = (
  rawValue: string,
  format: TimeFormat
): { valid: boolean; normalized?: string; error?: string } => {
  const value = rawValue.trim()

  if (!value) return { valid: true, normalized: '' }

  if (format === 'family') {
    const candidates: TimeFormat[] = ['datetime', 'date', 'time', 'seconds']
    for (const candidate of candidates) {
      const result = normalizeTimeInput(value, candidate)
      if (result.valid) return result
    }
    return {
      valid: false,
      error:
        'Use YYYY-MM-DD, HH:mm:ss, seconds (digits), or YYYY-MM-DDTHH:mm:ssZ',
    }
  }

  if (format === 'seconds') {
    if (!SECONDS_RE.test(value)) {
      return { valid: false, error: 'Use seconds as digits only (e.g., 90)' }
    }
    return { valid: true, normalized: value }
  }

  if (format === 'date') {
    if (!DATE_RE.test(value)) {
      return { valid: false, error: 'Use YYYY-MM-DD' }
    }
    const [yearStr, monthStr, dayStr] = value.split('-')
    const year = Number.parseInt(yearStr, 10)
    const month = Number.parseInt(monthStr, 10)
    const day = Number.parseInt(dayStr, 10)
    if (!isValidDate(year, month, day)) {
      return { valid: false, error: 'Invalid date (YYYY-MM-DD)' }
    }
    return { valid: true, normalized: value }
  }

  if (format === 'time') {
    if (!TIME_RE.test(value)) {
      return { valid: false, error: 'Use HH:mm:ss (24-hour)' }
    }
    const parts = value.split(':')
    const hours = Number.parseInt(parts[0], 10)
    const minutes = Number.parseInt(parts[1], 10)
    const seconds = Number.parseInt(parts[2] ?? '0', 10)
    if (!isValidTime(hours, minutes, seconds)) {
      return { valid: false, error: 'Invalid time (HH:mm:ss)' }
    }
    return {
      valid: true,
      normalized: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`,
    }
  }

  if (!DATETIME_RE.test(value)) {
    return { valid: false, error: 'Use YYYY-MM-DDTHH:mm:ssZ (UTC)' }
  }

  const datePart = value.slice(0, 10)
  const timePart = value.slice(11, 19)
  const [yearStr, monthStr, dayStr] = datePart.split('-')
  const [hourStr, minuteStr, secondStr] = timePart.split(':')
  const year = Number.parseInt(yearStr, 10)
  const month = Number.parseInt(monthStr, 10)
  const day = Number.parseInt(dayStr, 10)
  const hours = Number.parseInt(hourStr, 10)
  const minutes = Number.parseInt(minuteStr, 10)
  const seconds = Number.parseInt(secondStr, 10)

  if (!isValidDate(year, month, day) || !isValidTime(hours, minutes, seconds)) {
    return { valid: false, error: 'Invalid datetime (YYYY-MM-DDTHH:mm:ssZ)' }
  }

  return {
    valid: true,
    normalized: `${datePart}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}Z`,
  }
}

export const validateTimeInput = (
  rawValue: string,
  format: TimeFormat
): { valid: boolean; error?: string } => {
  const result = normalizeTimeInput(rawValue, format)
  if (!result.valid) return { valid: false, error: result.error }
  return { valid: true }
}

export const inferTimeFormatFromText = (rawText: string): TimeFormat | null => {
  const text = rawText.toLowerCase()

  if (!text || EXCLUDE_HINT_RE.test(text)) return null
  if (text.includes('cron')) return null
  if (RELATIVE_TIME_HINT_RE.test(text) || DURATION_STRING_HINT_RE.test(text)) return null
  if (
    text.includes('timezone') &&
    !TIME_HINT_RE.test(text) &&
    !DATE_HINT_RE.test(text)
  ) {
    return null
  }

  const hasDateHint = DATE_HINT_RE.test(text) || text.includes('date')
  const hasTimeHint = TIME_HINT_RE.test(text)
  const hasDateTimeHint = DATETIME_HINT_RE.test(text)
  const hasSecondsHint = SECONDS_HINT_RE.test(text) || DURATION_HINT_RE.test(text)

  if (hasSecondsHint && !hasDateHint && !hasTimeHint && !hasDateTimeHint) return 'seconds'

  if (hasDateTimeHint || (hasDateHint && hasTimeHint)) return 'datetime'
  if (hasDateHint) return 'date'
  if (hasTimeHint) return 'time'

  if (TIME_RELATED_HINT_RE.test(text)) return 'family'

  return null
}

export const inferTimeFormatFromConfig = (config: {
  id?: string
  type?: string
  title?: string
  placeholder?: string
  description?: string
  format?: string
  wandConfig?: { prompt?: string; placeholder?: string }
}): TimeFormat | null => {
  if (config.format) return config.format as TimeFormat

  if (config.type === 'datetime-input') return 'datetime'
  if (config.type === 'time-input') return 'time'

  const text = [
    config.id,
    config.title,
    config.placeholder,
    config.description,
    config.wandConfig?.prompt,
    config.wandConfig?.placeholder,
  ]
    .filter(Boolean)
    .join(' ')

  return inferTimeFormatFromText(text)
}

export const inferTimeFormatFromSchema = (
  paramName: string,
  paramSchema: { format?: string; description?: string }
): TimeFormat | null => {
  if (paramSchema.format === 'date-time') return 'datetime'
  if (paramSchema.format === 'date') return 'date'
  if (paramSchema.format === 'time') return 'time'

  const text = [paramName, paramSchema.description].filter(Boolean).join(' ')
  return inferTimeFormatFromText(text)
}
