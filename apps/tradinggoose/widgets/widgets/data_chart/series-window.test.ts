import { describe, expect, it } from 'vitest'
import { resolveExpectedBars } from './utils/series-loader'

describe('chart range windows', () => {
  it('preserves millisecond bounds before 2001 when estimating chart bars', () => {
    const start = Date.UTC(2000, 0, 1)
    expect(resolveExpectedBars({ mode: 'absolute', start, end: start + 86_400_000 }, '1d')).toBe(1)
  })
})
