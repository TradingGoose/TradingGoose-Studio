import { describe, expect, it } from 'vitest'
import { parseTagFilters } from './tags'

describe('Knowledge text filter adapter', () => {
  it('accepts editor JSON and combines same-tag alternatives without overwriting', () => {
    const rows = [
      { tagName: 'category', tagValue: 'api' },
      { tagName: 'category', tagValue: 'guide' },
      { tagName: 'priority', tagValue: 'high' },
    ]
    expect(parseTagFilters(JSON.stringify(rows))).toEqual({
      category: 'api|OR|guide',
      priority: 'high',
    })
    expect(parseTagFilters(rows)).toEqual(parseTagFilters(JSON.stringify(rows)))
  })

  it('preserves false and zero as text equality values', () => {
    expect(
      parseTagFilters([
        { tagName: 'enabled', tagValue: false },
        { tagName: 'count', tagValue: 0 },
      ])
    ).toEqual({ enabled: 'false', count: '0' })
  })

  it('ignores only genuinely empty editor rows', () => {
    expect(parseTagFilters([{ id: 'empty', tagName: '', tagValue: '' }])).toEqual({})
    expect(parseTagFilters(null)).toEqual({})
    expect(parseTagFilters('')).toEqual({})
    expect(() => parseTagFilters([{ tagName: 'category', tagValue: '' }])).toThrow()
    expect(() => parseTagFilters([{ tagName: '', tagValue: 'restricted' }])).toThrow()
  })

  it.each(['{broken', '{}', '[null]', '[1]'])(
    'rejects malformed input %s rather than broadening the search',
    (value) => {
      expect(() => parseTagFilters(value)).toThrow()
    }
  )

  it.each([
    { operator: 'neq' },
    { operator: 'gte' },
    { operator: false },
    { operator: '' },
    { fieldType: 'number' },
    { fieldType: null },
    { tagValue: {} },
    { tagValue: null },
    { tagValue: Number.NaN },
    { tagValue: '|OR|' },
  ])('rejects unsupported filter settings %j', (overrides) => {
    expect(() =>
      parseTagFilters([{ tagName: 'category', tagValue: 'api', ...overrides }])
    ).toThrow()
  })
})
