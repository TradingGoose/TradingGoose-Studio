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
  it('splits non-gray linked params into shared colorPairs and keeps local params on the widget', () => {
    const result = apply({ patch: { params: { listing, data: { provider: 'alpaca' } } } })

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

  it('changes one linked widget without clearing another color store', () => {
    const result = apply({
      widgetKey: 'editor_workflow',
      widget: widget('blue'),
      colorPairs: {
        pairs: [
          { color: 'red', indicatorId: 'indicator-a' },
          { color: 'blue', indicatorId: 'indicator-a' },
        ],
      },
      panelId: 'blue-panel',
      patch: { params: { workflowId: 'workflow-1' } },
    })

    expect(widgetOf(result)).toEqual({
      key: 'editor_workflow',
      pairColor: 'blue',
      params: null,
    })
    expect(result.colorPairs).toEqual({
      pairs: [
        { color: 'blue', indicatorId: 'indicator-a', workflowId: 'workflow-1' },
        { color: 'red', indicatorId: 'indicator-a' },
      ],
    })
  })

  it('rejects unsupported widget params before persistence', () => {
    expect(() => apply({ patch: { params: { listing, invented: true } } })).toThrow(
      'params.invented: Widget "data_chart" does not support this field'
    )
  })

  it('patches provided params by default without replacing existing local params', () => {
    expect(widgetOf(apply({ patch: { params: { view: { interval: '1h' } } } })).params).toEqual({
      data: { provider: 'alpaca' },
      view: { interval: '1h' },
    })
  })

  it('replaces params only when the internal params mode is explicit', () => {
    const result = apply({
      patch: { paramsMode: 'replace', params: { view: { interval: '1h' } } },
    })
    expect(widgetOf(result).params).toEqual({ view: { interval: '1h' } })
  })

  it('rejects colorPair for gray widgets', () => {
    expect(() => apply({ patch: { pairColor: 'gray', colorPair: { listing } } })).toThrow(
      'colorPair requires a non-gray pairColor'
    )
  })

  it('deletes one linked color-pair field when colorPair contains an explicit null', () => {
    const result = apply({
      colorPairs: { pairs: [{ color: 'red', listing: normalizedListing }] },
      patch: { colorPair: { listing: null } },
    })
    expect(result.colorPairs).toEqual({ pairs: [] })
  })

  it('accepts identical linked values submitted in params and colorPair once', () => {
    const result = apply({ patch: { params: { listing }, colorPair: { listing } } })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
  })

  it('rejects conflicting linked values submitted through both paths', () => {
    expect(() =>
      apply({
        patch: {
          params: { listing },
          colorPair: {
            listing: { ...listing, listing_id: 'MSFT', base_id: 'MSFT' },
          },
        },
      })
    ).toThrow('Conflicting linked colorPair field "listing"')
  })

  it('carries linked fields to a new pair color without pruning the source color', () => {
    const result = apply({
      colorPairs: {
        pairs: [{ color: 'red', workflowId: 'workflow-red', listing: normalizedListing }],
      },
      patch: { pairColor: 'blue' },
    })
    expect(result.colorPairs).toEqual({
      pairs: [
        { color: 'blue', listing: normalizedListing },
        { color: 'red', workflowId: 'workflow-red', listing: normalizedListing },
      ],
    })
  })

  it('lets explicit colorPair fields override carried state', () => {
    const result = apply({
      widgetKey: 'editor_workflow',
      widget: widget('red'),
      panelId: 'panel-workflow',
      colorPairs: { pairs: [{ color: 'red', workflowId: 'workflow-red' }] },
      patch: { pairColor: 'blue', colorPair: { workflowId: 'workflow-blue' } },
    })
    expect(result.colorPairs).toEqual({
      pairs: [
        { color: 'blue', workflowId: 'workflow-blue' },
        { color: 'red', workflowId: 'workflow-red' },
      ],
    })
  })

  it('rejects an unknown current widget key', () => {
    expect(() => apply({ widgetKey: 'unknown_widget', widget: widget('gray') })).toThrow(
      'Unknown widget key "unknown_widget"'
    )
  })
})
