import { DATE_KEY_RE, MARKET_DAY_MS } from './constants'

export function toZonedIsoTimestamp(
  raw: string,
  formatter: Intl.DateTimeFormat
): string | undefined {
  const local = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T')
  let timestamp = Date.parse(`${local}Z`)
  if (!Number.isFinite(timestamp)) return undefined
  // Resolve the source wall clock in its actual timezone, including daylight saving time.
  for (let pass = 0; pass < 2; pass++) {
    const zone = formatter
      .formatToParts(new Date(timestamp))
      .find(({ type }) => type === 'timeZoneName')!
    const offset = zone.value.replace('GMT', '') || '+00:00'
    timestamp = Date.parse(`${local}${offset}`)
  }
  return new Date(timestamp).toISOString()
}

export const toDate = (value?: string | number): Date | null => {
  if (value === undefined || value === null) return null
  const timestamp =
    typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value
  const date = new Date(
    typeof timestamp === 'number' && Math.abs(timestamp) < 10_000_000_000
      ? timestamp * 1000
      : timestamp
  )
  return Number.isNaN(date.getTime()) ? null : date
}

export const toDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`

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

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * MARKET_DAY_MS)
