import { DATE_KEY_RE, MARKET_DAY_MS } from './constants'

export const toDate = (value?: string | number): Date | null => {
  if (value === undefined || value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const toDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`

export const toDateKeyValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (DATE_KEY_RE.test(trimmed)) return trimmed
    const parsed = toDate(trimmed)
    return parsed ? toDateKey(parsed) : null
  }
  if (value instanceof Date) return toDateKey(value)
  if (typeof value === 'number') {
    const parsed = toDate(value)
    return parsed ? toDateKey(parsed) : null
  }
  return null
}

export const parseDateKey = (dateKey: string): Date | null => {
  if (!DATE_KEY_RE.test(dateKey)) return null
  const [year, month, day] = dateKey.split('-').map((value) => Number(value))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const utcMs = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(utcMs)) return null
  const date = new Date(utcMs)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

export const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * MARKET_DAY_MS)
