import { describe, expect, it } from 'vitest'
import { sortJsonValue, stableStringifyJsonValue } from '@/lib/json/stable'

describe('stable JSON helpers', () => {
  it('sorts object keys recursively before stringifying', () => {
    const left = { b: 1, a: { d: 4, c: 3 } }
    const right = { a: { c: 3, d: 4 }, b: 1 }

    expect(sortJsonValue(left)).toEqual(right)
    expect(stableStringifyJsonValue(left)).toBe(stableStringifyJsonValue(right))
  })

  it('preserves decoded JSON keys that also name prototype properties', () => {
    const value = JSON.parse('{"__proto__":{"a":1},"constructor":"kept"}')
    expect(JSON.parse(stableStringifyJsonValue(value))).toEqual(value)
    expect(Object.getPrototypeOf(sortJsonValue(value))).toBeNull()
  })
})
