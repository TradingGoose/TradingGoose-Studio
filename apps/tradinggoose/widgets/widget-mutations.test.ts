import { describe, expect, it } from 'vitest'
import type { PairColor } from '@/widgets/pair-colors'
import { resolveEffectiveWidgetParams } from '@/widgets/widget-contracts'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'

const listing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: 'AAPL',
  quote_id: 'USD',
}
const normalizedListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
} as const

type MutationInput = Parameters<typeof applyWidgetConfigMutation>[0]
type MutationResult = ReturnType<typeof applyWidgetConfigMutation>

const withDefaults = (over: Partial<MutationInput>): MutationInput => ({
  origin: 'human',
  widgetKey: 'data_chart',
  widget: {
    pairColor: 'red',
    params: { data: { provider: 'alpaca' } },
  },
  colorPairs: { pairs: [] },
  panelId: 'chart-panel',
  patch: {},
  ...over,
})

const apply = (over: Partial<MutationInput>) => applyWidgetConfigMutation(withDefaults(over))
const widgetOf = (result: MutationResult) => ({
  key: result.widgetKey,
  ...result.widgetDocument,
})
const widget = (
  pairColor: PairColor,
  params: Record<string, unknown> | null = null
): MutationInput['widget'] => ({ pairColor, params })

describe('applyWidgetConfigMutation', () => {
  it('keeps params-only edits local and produces no shared pair diff', () => {
    const colorPairs = { pairs: [{ color: 'red' as const, listing: normalizedListing }] }
    const result = apply({
      colorPairs,
      patch: { params: { view: { interval: '1h' } } },
    })

    expect(widgetOf(result).params).toEqual({
      data: { provider: 'alpaca' },
      view: { interval: '1h' },
    })
    expect(result.colorPairs).toEqual(colorPairs)
    expect(result.colorPairDiff).toEqual([])
    expect(result.changedPaths).toEqual(['widget.params'])
  })

  it('rejects linked params for a non-gray widget with explicit colorPair guidance', () => {
    expect(() => apply({ patch: { params: { listing } } })).toThrow(
      'params.listing: Shared color-pair field "listing" must be updated through colorPair for non-gray widgets'
    )
  })

  it('keeps linked params local for a gray widget', () => {
    const colorPairs = { pairs: [{ color: 'red' as const, listing: normalizedListing }] }
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('gray', { provider: 'alpaca' }),
      colorPairs,
      patch: { params: { listing } },
    })

    expect(widgetOf(result)).toEqual({
      key: 'watchlist',
      pairColor: 'gray',
      params: { provider: 'alpaca', listing: normalizedListing },
    })
    expect(result.colorPairs).toEqual(colorPairs)
    expect(result.colorPairDiff).toEqual([])
  })

  it('uses an explicit colorPair object as the only shared pair upsert path', () => {
    const result = apply({ patch: { colorPair: { listing } } })

    expect(widgetOf(result)).toEqual({
      key: 'data_chart',
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
    expect(result.colorPairDiff).toEqual([
      {
        color: 'red',
        before: {},
        after: { listing: normalizedListing },
        changedFields: ['listing'],
      },
    ])
    expect(resolveEffectiveWidgetParams(widgetOf(result), result.colorPairs)).toMatchObject({
      listing: normalizedListing,
    })
  })

  it('uses explicit colorPair null as the only whole-pair clear path', () => {
    const result = apply({
      colorPairs: {
        pairs: [{ color: 'red', workflowId: 'workflow-red', listing: normalizedListing }],
      },
      patch: { colorPair: null },
    })

    expect(result.colorPairs).toEqual({ pairs: [] })
    expect(result.colorPairDiff).toHaveLength(1)
    expect(result.changedPaths).toEqual(['colorPairs'])
  })

  it('clears one explicit pair field while preserving unrelated shared fields', () => {
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('red'),
      colorPairs: {
        pairs: [{ color: 'red', watchlistId: 'watchlist-red', listing: normalizedListing }],
      },
      patch: { colorPair: { listing: null } },
    })

    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', watchlistId: 'watchlist-red' }],
    })
  })

  it('changes pairColor without copying, clearing, or dirtying shared pair state', () => {
    const colorPairs = {
      pairs: [
        { color: 'blue' as const, listing: normalizedListing },
        { color: 'red' as const, workflowId: 'workflow-red' },
      ],
    }
    const result = apply({
      widget: widget('red', { data: { provider: 'alpaca' } }),
      colorPairs,
      patch: { pairColor: 'blue' },
    })

    expect(widgetOf(result)).toEqual({
      key: 'data_chart',
      pairColor: 'blue',
      params: { data: { provider: 'alpaca' } },
    })
    expect(result.colorPairs).toEqual(colorPairs)
    expect(result.colorPairDiff).toEqual([])
    expect(result.changedPaths).toEqual(['widget.pairColor'])
    expect(result.reviewBase).toEqual({
      pairColor: 'red',
      colorPair: { color: 'blue', context: { listing: normalizedListing } },
    })
  })

  it('preserves gray local linked params when selecting a shared pair', () => {
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('gray', { listing: normalizedListing }),
      colorPairs: { pairs: [{ color: 'blue', watchlistId: 'watchlist-blue' }] },
      patch: { pairColor: 'blue' },
    })

    expect(widgetOf(result)).toEqual({
      key: 'watchlist',
      pairColor: 'blue',
      params: { listing: normalizedListing },
    })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'blue', watchlistId: 'watchlist-blue' }],
    })
    expect(result.colorPairDiff).toEqual([])
  })

  it.each([{ colorPair: { listing } }, { colorPair: null }])(
    'rejects explicit colorPair mutations for gray widgets',
    (patch) => {
      expect(() => apply({ widget: widget('gray'), patch })).toThrow(
        'colorPair requires a non-gray pairColor'
      )
    }
  )

  it('rejects unsupported widget params before persistence', () => {
    expect(() => apply({ patch: { params: { invented: true } } })).toThrow(
      'params.invented: Widget "data_chart" does not support this field'
    )
  })

  it('rejects an unknown current widget key', () => {
    expect(() => apply({ widgetKey: 'unknown_widget', widget: widget('gray') })).toThrow(
      'Unknown widget key "unknown_widget"'
    )
  })
})
