import { monetary } from '@tradinggoose/billing/money'
import type { LocaleCode } from './utils'

type FileSizeOptions = {
  fallback?: string
  maximumFractionDigits?: number
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatLocalizedNumber(
  locale: LocaleCode | string,
  value: number,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatUsd(
  locale: LocaleCode | string,
  value: string | number | null | undefined,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>
) {
  if (value === null || value === undefined) return '—'
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
    ...options,
  })
  if (typeof value === 'number') return formatter.format(value)
  const amount = monetary(value)
  // ECMA-402 accepts mathematical decimal strings; the installed TS lib omits that overload.
  const formatted: string = Reflect.apply(formatter.format, formatter, [amount])
  const infinity = formatter
    .formatToParts(Number.POSITIVE_INFINITY)
    .find((part) => part.type === 'infinity')!
  if (!formatted.includes(infinity.value)) return formatted
  // NUMERIC can exceed Intl's finite formatting range. Preserve the complete known value.
  return formatter
    .formatToParts(0)
    .map((part) =>
      part.type === 'integer'
        ? amount
        : ['currency', 'literal'].includes(part.type)
          ? part.value
          : ''
    )
    .join('')
}

export function formatFileSize(
  locale: LocaleCode | string,
  bytes: number | null | undefined,
  { fallback = '—', maximumFractionDigits = 1 }: FileSizeOptions = {}
) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return fallback
  }

  if (bytes <= 0) {
    return '0 B'
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    FILE_SIZE_UNITS.length - 1
  )
  const normalized = bytes / 1024 ** unitIndex
  const digits = normalized >= 10 ? 0 : maximumFractionDigits

  return `${formatLocalizedNumber(locale, normalized, {
    maximumFractionDigits: digits,
  })} ${FILE_SIZE_UNITS[unitIndex]}`
}

export function formatDurationMs(
  locale: LocaleCode | string,
  durationMs: number | null | undefined
) {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) {
    return null
  }

  return `${formatLocalizedNumber(locale, durationMs)} ms`
}
