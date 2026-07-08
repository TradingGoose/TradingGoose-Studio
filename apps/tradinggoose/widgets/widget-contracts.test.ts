import { describe, expect, it } from 'vitest'
import {
  getWidgetContract,
  listWidgetCatalogItems,
  readEntitySelectionState,
  readWidgetMetadataProfiles,
  resolveEntityIdFromList,
  sanitizeWidgetInstance,
  WIDGET_KEYS,
} from '@/widgets/widget-contracts'

const CONTRACT_FNS = [
  'sanitizeLocalParams',
  'mergeLocalParams',
  'splitPatchForPairColor',
  'resolveEffectiveParams',
  'resolveParamsForPairColorChange',
] as const

describe('dashboard widget contracts', () => {
  it.each(WIDGET_KEYS)(
    'defines an executable contract with metadata and defaults for %s',
    (key) => {
      const contract = getWidgetContract(key)

      expect(contract.key).toBe(key)
      for (const fn of CONTRACT_FNS) {
        expect(typeof contract[fn]).toBe('function')
      }
      expect(contract.title.trim()).not.toBe('')
      expect(['editor', 'list', 'utility', 'trading']).toContain(contract.category)
      expect(contract.description.trim()).not.toBe('')
      expect(contract.createDefaultInstance()).toEqual({
        key,
        pairColor: 'gray',
        params: contract.defaultParams,
      })
      expect(contract.editableFields).toEqual(contract.paramContract.map((field) => field.field))
    }
  )

  it.each(WIDGET_KEYS)('rejects unsupported strict params for %s', (key) => {
    expect(() =>
      getWidgetContract(key).sanitizeLocalParams(
        { unsupported_contract_field: true },
        { strictUnknown: true }
      )
    ).toThrow()
  })

  it.each(WIDGET_KEYS)('round-trips linked split/effective params for %s', (key) => {
    const contract = getWidgetContract(key)
    const input = Object.fromEntries(
      contract.linkedParamFields.map((field) => [
        field,
        field === 'listing'
          ? {
              listing_id: 'AAPL',
              listing_type: 'default',
              base_id: '',
              quote_id: '',
            }
          : `${field}-1`,
      ])
    )

    const split = contract.splitPatchForPairColor(input, 'red')
    const widget = { key, pairColor: 'red' as const, params: null }
    if (contract.linkedParamFields.length === 0) {
      expect(split.linkedPatch).toEqual({})
      expect(contract.resolveEffectiveParams(widget, split.linkedPatch).params).toBeNull()
      return
    }

    expect(Object.keys(split.linkedPatch).sort()).toEqual([...contract.linkedParamFields].sort())
    expect(split.localPatch).toBeNull()
    expect(contract.resolveEffectiveParams(widget, split.linkedPatch).params).toEqual(
      split.linkedPatch
    )
  })

  it.each(WIDGET_KEYS)('serializes %s metadata without executable functions', (key) => {
    const [profile] = readWidgetMetadataProfiles([key]) as Array<Record<string, unknown>>

    expect(profile?.widgetKey).toBe(key)
    expect(profile.defaultParams).toEqual(getWidgetContract(key).defaultParams)
    expect(profile.editableFields).toBeDefined()
    for (const fn of ['createDefaultInstance', ...CONTRACT_FNS]) {
      expect(profile[fn]).toBeUndefined()
    }
  })

  it('lists compact widget catalog items without full metadata or executable functions', () => {
    const [item] = listWidgetCatalogItems({ category: 'trading' }) as Array<Record<string, unknown>>

    expect(item?.category).toBe('trading')
    expect(item?.widgetKey).toBeDefined()
    expect(item?.defaultParams).toBeUndefined()
    expect(item?.paramContract).toBeUndefined()
  })

  it('rejects unknown widget keys during contract sanitization', () => {
    const widget = { key: 'unknown_widget', pairColor: 'gray', params: null }
    expect(() => sanitizeWidgetInstance(widget)).toThrow('Unknown widget key "unknown_widget"')
    expect(() => sanitizeWidgetInstance(widget, { strict: false })).toThrow(
      'Unknown widget key "unknown_widget"'
    )
  })

  it('uses data-chart contract merge rules for nested provider and view params', () => {
    expect(
      getWidgetContract('data_chart').mergeLocalParams(
        {
          data: { provider: ' polygon ', symbol: 'AAPL' },
          view: { interval: '1h' },
        },
        {
          data: { providerParams: { apiKey: 'secret' } },
          view: { theme: 'dark' },
        },
        'patch'
      ).params
    ).toEqual({
      data: { provider: 'polygon', symbol: 'AAPL' },
      view: { interval: '1h', theme: 'dark' },
    })
  })

  it('exposes data-chart editable params through metadata', () => {
    const [profile] = readWidgetMetadataProfiles(['data_chart'])
    const fields = profile.paramContract.map((field) => field.field)
    expect(fields).toEqual(['listing', 'data', 'view', 'runtime'])
    expect(fields).not.toContain('indicators')
  })

  it('keeps heatmap listing as the only linked pair field', () => {
    const split = getWidgetContract('heatmap').splitPatchForPairColor(
      {
        listing: {
          listing_id: 'AAPL',
          listing_type: 'default',
          provider: 'ignored',
        },
        sourceMode: 'watchlist',
      },
      'red'
    )

    expect(split.localPatch).toEqual({ sourceMode: 'watchlist' })
    expect(split.linkedPatch).toEqual({
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
  })

  it('resolves entity selections through the widget contract helpers', () => {
    expect(
      readEntitySelectionState({
        pairContext: { skillId: 'skill-linked' },
        params: { skillId: 'skill-param' },
        entityIdKey: 'skillId',
      })
    ).toEqual({ selectedEntityId: 'skill-linked' })

    const entityIds = ['a', 'b']
    expect(
      resolveEntityIdFromList({
        requestedEntityId: 'deleted',
        currentEntityId: 'a',
        entityIds,
      })
    ).toBeNull()
    expect(resolveEntityIdFromList({ requestedEntityId: 'deleted', entityIds })).toBeNull()
    expect(resolveEntityIdFromList({ currentEntityId: 'b', entityIds })).toBe('b')
    expect(resolveEntityIdFromList({ entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ requestedEntityId: '', entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ entityIds, useDefaultEntity: false })).toBeNull()
  })
})
