import { describe, expect, it } from 'vitest'
import type { PairColor } from '@/widgets/pair-colors'
import { resolveEffectiveWidgetParams } from '@/widgets/widget-contracts'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'

const listing = {
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
  patch: {},
  ...over,
})

const apply = (over: Partial<MutationInput>) => applyWidgetConfigMutation(withDefaults(over))
const widgetOf = (result: MutationResult, key = 'data_chart') => ({
  key,
  ...result.widgetDocument,
})
const widget = (
  pairColor: PairColor,
  params: Record<string, unknown> | null = null
): MutationInput['widget'] => ({ pairColor, params })

describe('applyWidgetConfigMutation', () => {
  it('keeps params-only edits local and produces no shared pair diff', () => {
    const colorPairs = { pairs: [{ color: 'red' as const, listing }] }
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
    expect(result.widgetChanged).toBe(true)
  })

  it('rejects linked params for a non-gray widget with explicit colorPair guidance', () => {
    expect(() => apply({ patch: { params: { listing } } })).toThrow(
      'params.listing: Shared color-pair field "listing" must be updated through colorPair for non-gray widgets'
    )
  })

  it('keeps linked params local for a gray widget', () => {
    const colorPairs = { pairs: [{ color: 'red' as const, listing }] }
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('gray', { provider: 'alpaca' }),
      colorPairs,
      patch: { params: { listing } },
    })

    expect(widgetOf(result, 'watchlist')).toEqual({
      key: 'watchlist',
      pairColor: 'gray',
      params: { provider: 'alpaca', listing },
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
      pairs: [{ color: 'red', listing }],
    })
    expect(result.colorPairDiff).toEqual([
      {
        color: 'red',
        before: {},
        after: { listing },
        changedFields: ['listing'],
      },
    ])
    expect(resolveEffectiveWidgetParams(widgetOf(result), result.colorPairs)).toMatchObject({
      listing,
    })
  })

  it('clears one explicit pair field while preserving unrelated shared fields', () => {
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('red'),
      colorPairs: {
        pairs: [{ color: 'red', watchlistId: 'watchlist-red', listing }],
      },
      patch: { colorPair: { listing: null } },
    })

    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', watchlistId: 'watchlist-red' }],
    })
  })

  it('keeps existing destination values when changing pair color', () => {
    const colorPairs = {
      pairs: [
        { color: 'blue' as const, listing },
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
    expect(result.widgetChanged).toBe(true)
  })

  it('moves gray linked params into missing destination fields', () => {
    const result = apply({
      widgetKey: 'watchlist',
      widget: widget('gray', { listing }),
      colorPairs: { pairs: [{ color: 'blue', watchlistId: 'watchlist-blue' }] },
      patch: { pairColor: 'blue' },
    })

    expect(widgetOf(result, 'watchlist')).toEqual({
      key: 'watchlist',
      pairColor: 'blue',
      params: null,
    })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'blue', watchlistId: 'watchlist-blue', listing }],
    })
    expect(result.colorPairDiff).toEqual([
      {
        color: 'blue',
        before: { watchlistId: 'watchlist-blue' },
        after: { watchlistId: 'watchlist-blue', listing },
        changedFields: ['listing'],
      },
    ])
  })

  it('inherits missing destination fields from the active pair without changing the source', () => {
    const result = apply({
      widget: widget('red', { data: { provider: 'alpaca' } }),
      colorPairs: {
        pairs: [
          { color: 'blue', workflowId: 'workflow-blue' },
          { color: 'red', listing },
        ],
      },
      patch: { pairColor: 'blue' },
    })

    expect(widgetOf(result)).toEqual({
      key: 'data_chart',
      pairColor: 'blue',
      params: { data: { provider: 'alpaca' } },
    })
    expect(result.colorPairs).toEqual({
      pairs: [
        { color: 'blue', workflowId: 'workflow-blue', listing },
        { color: 'red', listing },
      ],
    })
  })

  it('moves active pair fields into local params when changing to gray', () => {
    const result = apply({
      widget: widget('red', { data: { provider: 'alpaca' } }),
      colorPairs: { pairs: [{ color: 'red', listing }] },
      patch: { pairColor: 'gray' },
    })

    expect(widgetOf(result)).toEqual({
      key: 'data_chart',
      pairColor: 'gray',
      params: { data: { provider: 'alpaca' }, listing },
    })
    expect(result.colorPairs).toEqual({ pairs: [{ color: 'red', listing }] })
    expect(result.colorPairDiff).toEqual([])
  })

  it('rejects explicit colorPair mutations for gray widgets', () => {
    expect(() => apply({ widget: widget('gray'), patch: { colorPair: { listing } } })).toThrow(
      'colorPair requires a non-gray pairColor'
    )
  })

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
