import { describe, expect, it } from 'vitest'
import { resultAccounting, selectNativeUsage, sumNativeUsage } from './usage'

describe('public active result facts', () => {
  it('keeps reported zero, missing counts, and native total independently without inferring dollars', () => {
    expect(resultAccounting({ inputTokens: 0, totalTokens: 7 })).toEqual({
      tokens: { prompt: 0, total: 7 },
      cost: { status: 'unavailable' },
    })
    expect(resultAccounting()).toEqual({ tokens: {}, cost: { status: 'unavailable' } })
  })
  it('sums completed partial steps once and excludes repeated error callback usage', () => {
    expect(
      sumNativeUsage([
        { usage: { inputTokens: 2, totalTokens: 5 } },
        { usage: { inputTokens: 0, totalTokens: 3 } },
        { finishReason: 'error', response: { id: '' }, usage: { totalTokens: 3 } },
      ])
    ).toEqual({ inputTokens: 2, totalTokens: 8 })
  })
  it('does not publish invalid or negative upstream counts', () => {
    expect(
      resultAccounting({
        inputTokens: Number.NaN,
        outputTokens: -1,
        totalTokens: Number.POSITIVE_INFINITY,
      }).tokens
    ).toEqual({})
  })
})

it('chooses one valid usage representation without adding overlapping totals or erasing zero/partial facts', () => {
  const observed = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
  expect(
    selectNativeUsage({ inputTokens: 4, outputTokens: 6, totalTokens: 10 }, observed, observed)
  ).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 })
  expect(selectNativeUsage({}, observed, observed)).toEqual(observed)
  expect(selectNativeUsage({ totalTokens: Number.NaN }, observed)).toEqual(observed)
  expect(selectNativeUsage({ inputTokens: 0 }, observed)).toEqual({ inputTokens: 0 })
  expect(selectNativeUsage(undefined, {}, {})).toEqual({})
})
