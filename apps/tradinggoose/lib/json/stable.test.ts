import { describe, expect, it } from 'vitest'
import { sortJsonValue, stableStringifyJsonValue } from '@/lib/json/stable'

describe('stable JSON helpers', () => {
  it('sorts object keys recursively before stringifying', () => {
    const left = { b: 1, a: { d: 4, c: 3 } }
    const right = { a: { c: 3, d: 4 }, b: 1 }

    expect(sortJsonValue(left)).toEqual(right)
    expect(stableStringifyJsonValue(left)).toBe(stableStringifyJsonValue(right))
  })
})
