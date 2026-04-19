import { describe, expect, it } from 'vitest'
import {
  getIndicatorMetadataByIds,
  listIndicatorCatalog,
} from '@/lib/copilot/tools/server/indicators/indicator-reference'

describe('indicator reference catalog', () => {
  it('lists exact section ids and item ids for the indicator authoring surface', () => {
    const result = listIndicatorCatalog()

    expect(result.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'section:document' }),
        expect.objectContaining({ id: 'section:inputs' }),
        expect.objectContaining({ id: 'section:indicator_options' }),
        expect.objectContaining({ id: 'section:triggers' }),
      ])
    )
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'document.format', sectionId: 'section:document' }),
        expect.objectContaining({ id: 'input.int', sectionId: 'section:inputs' }),
        expect.objectContaining({
          id: 'indicator.overlay',
          sectionId: 'section:indicator_options',
        }),
        expect.objectContaining({ id: 'trigger.call', sectionId: 'section:triggers' }),
      ])
    )
    expect(result.count).toBe(result.items.length)
  })

  it('filters the catalog by section and query', () => {
    const result = listIndicatorCatalog({
      sections: ['section:inputs'],
      query: 'enum',
    })

    expect(result.sections).toEqual([expect.objectContaining({ id: 'section:inputs' })])
    expect(result.items).toEqual([expect.objectContaining({ id: 'input.enum' })])
  })

  it('returns exact metadata entries for section ids and item ids', () => {
    const result = getIndicatorMetadataByIds([
      'section:inputs',
      'input.int',
      'indicator.overlay',
      'missing.id',
    ])

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'section:inputs',
          type: 'section',
          relatedIds: expect.arrayContaining(['input.int']),
        }),
        expect.objectContaining({
          id: 'input.int',
          type: 'input_function',
          signature: expect.stringContaining('input.int'),
        }),
        expect.objectContaining({
          id: 'indicator.overlay',
          type: 'indicator_option',
        }),
      ])
    )
    expect(result.missingIds).toEqual(['missing.id'])
  })
})
