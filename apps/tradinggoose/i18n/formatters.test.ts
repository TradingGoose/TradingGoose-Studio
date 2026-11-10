import { describe, expect, it } from 'vitest'
import { formatDurationMs, formatFileSize, formatLocalizedNumber, formatUsd } from './formatters'

describe('i18n formatters', () => {
  it('formats locale-aware numbers', () => {
    expect(formatLocalizedNumber('en', 1200)).toBe('1,200')
    expect(formatLocalizedNumber('es', 1200.5)).toBe('1200,5')
  })

  it('formats USD amounts using the active locale', () => {
    expect(formatUsd('en', 24)).toContain('$24.00')
    expect(formatUsd('es', 24)).toContain('24,00')
  })

  it('formats file sizes with shared unit labels', () => {
    expect(formatFileSize('en', 0)).toBe('0 B')
    expect(formatFileSize('en', 1536)).toBe('1.5 KB')
    expect(formatFileSize('es', 1536)).toBe('1,5 KB')
    expect(formatFileSize('en', null, { fallback: 'Unknown size' })).toBe('Unknown size')
  })

  it('formats millisecond durations', () => {
    expect(formatDurationMs('en', 25)).toBe('25 ms')
    expect(formatDurationMs('es', 1200)).toBe('1200 ms')
    expect(formatDurationMs('en', null)).toBeNull()
  })
})

it('formats canonical monetary strings without binary64 conversion', () => {
  const value = '9007199254740993.1234567890123456789'
  expect(formatUsd('en', value, { maximumFractionDigits: 20 })).toBe(
    '$9,007,199,254,740,993.1234567890123456789'
  )
  expect(formatUsd('es', value, { maximumFractionDigits: 20 })).toContain(
    '9.007.199.254.740.993,1234567890123456789'
  )
  expect(formatUsd('en', '0')).toBe('$0.00')
  expect(formatUsd('en', null)).toBe('—')
  expect(formatUsd('en', undefined)).toBe('—')
  expect(() => formatUsd('en', 'NaN')).toThrow()
})

it('preserves full NUMERIC values beyond Intl finite formatting range', () => {
  const value = `1${'0'.repeat(400)}.1234567890123456789`
  expect(formatUsd('en', value)).toBe(`$${value}`)
})
