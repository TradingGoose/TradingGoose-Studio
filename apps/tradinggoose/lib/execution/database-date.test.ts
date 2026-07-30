import { describe, expect, it } from 'vitest'
import { requireDatabaseDate, requireNullableDatabaseDate } from './database-date'

describe('database timestamp normalization', () => {
  it('normalizes raw PostgreSQL timestamp strings', () => {
    expect(requireDatabaseDate('2026-07-29T15:47:39.061Z', 'clock timestamp')).toEqual(
      new Date('2026-07-29T15:47:39.061Z')
    )
  })

  it('preserves valid Date values', () => {
    const timestamp = new Date('2026-07-29T15:47:39.061Z')
    expect(requireDatabaseDate(timestamp, 'clock timestamp')).toBe(timestamp)
  })

  it.each([undefined, null, '', 'not-a-timestamp', {}, 1_753_804_859_061, Number.NaN])(
    'rejects invalid required values: %p',
    (value) => {
      expect(() => requireDatabaseDate(value, 'clock timestamp')).toThrow(
        'Database returned an invalid clock timestamp'
      )
    }
  )

  it('accepts only database null for a nullable timestamp', () => {
    expect(requireNullableDatabaseDate(null, 'deadline timestamp')).toBeNull()
    expect(() => requireNullableDatabaseDate(undefined, 'deadline timestamp')).toThrow(
      'Database returned an invalid deadline timestamp'
    )
  })
})
