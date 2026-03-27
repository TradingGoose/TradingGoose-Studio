import { describe, expect, it } from 'vitest'
import { resolveWidgetParamsForPairColorChange } from '@/widgets/layout'

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
