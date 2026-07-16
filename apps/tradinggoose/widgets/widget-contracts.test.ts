import { describe, expect, it } from 'vitest'
import {
  getWidgetContract,
  listWidgetCatalogItems,
  normalizeWidgetColorPairPatch,
  readWidgetMetadataProfiles,
  resolveEntityId,
  resolveEntityIdFromList,
  sanitizeWidgetInstance,
  WIDGET_KEYS,
} from '@/widgets/widget-contracts'

const CONTRACT_FNS = [
  'sanitizeLocalParams',
  'mergeLocalParams',
  'projectCopilotParams',
  'mergeCopilotParams',
  'resolveEffectiveParams',
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
        }
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
    expect(JSON.stringify(profile)).not.toContain('drawTools')
  })

  it('keeps heatmap listing as its only linked pair field', () => {
    expect(getWidgetContract('heatmap').linkedParamFields).toEqual(['listing'])
    expect(() => normalizeWidgetColorPairPatch('heatmap', { view: { interval: '1h' } })).toThrow(
      'does not support this linked color-pair field'
    )
  })

  it('lets shared pair context override linked local params without touching non-linked params', () => {
    const contract = getWidgetContract('watchlist')
    const result = contract.resolveEffectiveParams(
      {
        key: 'watchlist',
        pairColor: 'red',
        params: {
          watchlistId: 'watchlist-local',
          provider: 'alpaca',
        },
      },
      { watchlistId: 'watchlist-shared' }
    )

    expect(result.params).toEqual({
      watchlistId: 'watchlist-shared',
      provider: 'alpaca',
    })
  })

  it('resolves entity selections through the widget contract helpers', () => {
    expect(resolveEntityId('skillId', { params: { skillId: 'skill-param' } })).toBe('skill-param')

    const entityIds = ['a', 'b']
    expect(resolveEntityIdFromList({ requestedEntityId: 'b', entityIds })).toBe('b')
    expect(resolveEntityIdFromList({ requestedEntityId: 'deleted', entityIds })).toBeNull()
    expect(
      resolveEntityIdFromList({ requestedEntityId: 'deleted', entityIds, useDefaultEntity: false })
    ).toBeNull()
    expect(resolveEntityIdFromList({ entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ requestedEntityId: '', entityIds })).toBe('a')
    expect(resolveEntityIdFromList({ entityIds, useDefaultEntity: false })).toBeNull()
  })
})
