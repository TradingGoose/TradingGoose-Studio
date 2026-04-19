import { describe, expect, it } from 'vitest'
import {
  normalizeColorPairsState,
  normalizeDashboardLayout,
  resolveWidgetParamsForPairColorChange,
  serializeLayout,
} from '@/widgets/layout'

describe('resolveWidgetParamsForPairColorChange', () => {
  it('preserves full data chart params when switching to a linked color', () => {
    const params = {
      listing: {
        listing_id: 'btc-usd',
        base_id: 'btc',
        quote_id: 'usd',
        listing_type: 'spot',
      },
      data: {
        provider: 'alpaca',
        providerParams: { apiKey: 'key' },
      },
      view: {
        interval: '1h',
        marketSession: 'regular',
      },
    }

    expect(
      resolveWidgetParamsForPairColorChange(
        {
          key: 'data_chart',
          pairColor: 'gray',
          params,
        },
        'red'
      )
    ).toBe(params)
  })

  it('preserves data chart params when switching between linked colors', () => {
    const params = {
      data: {
        provider: 'polygon',
      },
      view: {
        interval: '15m',
      },
    }

    expect(
      resolveWidgetParamsForPairColorChange(
        {
          key: 'data_chart',
          pairColor: 'blue',
          params,
        },
        'green'
      )
    ).toBe(params)
  })

  it('clears non chart params when switching to a linked color', () => {
    expect(
      resolveWidgetParamsForPairColorChange(
        {
          key: 'watchlist',
          pairColor: 'gray',
          params: { provider: 'alpaca' },
        },
        'red'
      )
    ).toBeNull()
  })

  it('preserves existing params when switching back to gray', () => {
    const params = { workflowId: 'wf-1' }

    expect(
      resolveWidgetParamsForPairColorChange(
        {
          key: 'watchlist',
          pairColor: 'red',
          params,
        },
        'gray'
      )
    ).toBe(params)
  })
})

describe('normalizeColorPairsState', () => {
  it('does not migrate legacy review-session or indicator ids', () => {
    expect(
      normalizeColorPairsState({
        pairs: [
          {
            color: 'blue',
            workflowId: 'wf-1',
            copilotChatId: 'legacy-review-session',
            pineIndicatorId: 'legacy-indicator',
          },
        ],
      })
    ).toEqual({
      pairs: [
        {
          color: 'blue',
          workflowId: 'wf-1',
          listing: null,
          indicatorId: undefined,
          mcpServerId: undefined,
          customToolId: undefined,
          skillId: undefined,
        },
      ],
    })
  })

  it('reads nested reviewTarget format', () => {
    expect(
      normalizeColorPairsState({
        pairs: [
          {
            color: 'green',
            workflowId: 'wf-3',
            reviewTarget: {
              reviewSessionId: 'review-2',
              reviewEntityKind: 'indicator',
              reviewEntityId: 'ind-1',
            },
          },
        ],
      })
    ).toEqual({
      pairs: [
        {
          color: 'green',
          workflowId: 'wf-3',
          listing: null,
          reviewTarget: {
            reviewSessionId: 'review-2',
            reviewEntityKind: 'indicator',
            reviewEntityId: 'ind-1',
            reviewDraftSessionId: undefined,
          },
          indicatorId: undefined,
          mcpServerId: undefined,
          customToolId: undefined,
          skillId: undefined,
        },
      ],
    })
  })
})

describe('normalizeDashboardLayout', () => {
  it('preserves persisted node ids so panel-scoped widget channels stay stable across reloads', () => {
    const normalized = normalizeDashboardLayout({
      id: 'group-1',
      type: 'group',
      direction: 'horizontal',
      sizes: [100],
      children: [
        {
          id: 'panel-1',
          type: 'panel',
          widget: {
            key: 'copilot',
            pairColor: 'gray',
            params: null,
          },
        },
      ],
    })

    expect(normalized.id).toBe('group-1')
    expect(normalized.type).toBe('group')
    if (normalized.type !== 'group') {
      throw new Error('Expected normalized layout to remain a group')
    }

    expect(normalized.children[0]?.id).toBe('panel-1')
    expect(serializeLayout(normalized)).toMatchObject({
      id: 'group-1',
      children: [{ id: 'panel-1', type: 'panel' }],
    })
  })

  it('clears persisted copilot params instead of keeping sticky context state', () => {
    const normalized = normalizeDashboardLayout({
      type: 'panel',
      widget: {
        key: 'copilot',
        pairColor: 'blue',
        params: {
          workflowId: 'wf-1',
          reviewSessionId: 'review-1',
        },
      },
    })

    expect(normalized.type).toBe('panel')
    if (normalized.type !== 'panel') {
      throw new Error('Expected normalized copilot layout to remain a panel')
    }

    expect(normalized.widget).toMatchObject({
      key: 'copilot',
      pairColor: 'blue',
      params: null,
    })
  })
})
