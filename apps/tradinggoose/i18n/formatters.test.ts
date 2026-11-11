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
