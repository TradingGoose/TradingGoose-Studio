import { describe, expect, it } from 'vitest'
import { formatCost } from './cost'

describe('cost presentation', () => {
  it.each([
    [1.234, '$1.23'],
    [0.0234, '$0.023'],
    [0.00234, '$0.0023'],
    [0.000234, '$0.0002340'],
    [0, '$0'],
  ] as const)('formats available cost %s', (value, expected) => {
    expect(formatCost(value)).toBe(expected)
  })
  it('distinguishes unavailable dollars from native zero', () => {
    expect(formatCost(undefined)).toBe('Unavailable')
    expect(formatCost(null)).toBe('Unavailable')
    expect(formatCost(0)).toBe('$0')
  })
})
