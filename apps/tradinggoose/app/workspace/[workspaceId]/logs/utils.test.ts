import { describe, expect, it } from 'vitest'
import { parseDuration } from './utils'

describe('logs utils', () => {
  it('reads only canonical durationMs values', () => {
    expect(parseDuration({ durationMs: 123, totalDurationMs: 999 })).toBe(123)
    expect(parseDuration({ durationMs: '456ms' })).toBeNull()
    expect(parseDuration({ totalDurationMs: 999 })).toBeNull()
  })
})
