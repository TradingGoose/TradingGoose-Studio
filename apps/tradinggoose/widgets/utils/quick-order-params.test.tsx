/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitQuickOrderParamsChange,
  sanitizeQuickOrderParams,
  useQuickOrderParamsPersistence,
} from '@/widgets/utils/quick-order-params'

function Harness({
  params,
  onChange,
}: {
  params?: Record<string, unknown> | null
  onChange: (params: Record<string, unknown> | null) => void
}) {
  useQuickOrderParamsPersistence({
    params,
    onWidgetParamsChange: onChange,
    panelId: 'panel-1',
    widget: { key: 'quick_order' } as any,
  })
  return null
}

describe('quick order params utilities', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps only header-level quick order params', () => {
    expect(
      sanitizeQuickOrderParams({
        provider: ' alpaca ',
        marketProvider: ' yahoo-finance ',
        marketProviderParams: {
          region: 'US',
          apiKey: 'not-persisted-here',
        },
        marketAuth: {
          apiKey: 'market-key',
          apiSecret: 'market-secret',
        },
        accountId: 'acct-1',
        side: 'sell',
        quantity: 1,
        orderClass: 'equity',
        providerParams: { orderClass: 'equity' },
      })
    ).toEqual({
      provider: 'alpaca',
      marketProvider: 'yahoo-finance',
      marketProviderParams: {
        region: 'US',
      },
      marketAuth: {
        apiKey: 'market-key',
        apiSecret: 'market-secret',
      },
      accountId: 'acct-1',
      side: 'sell',
    })
  })

  it('merges scoped header update events', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(<Harness params={{ provider: 'alpaca', side: 'buy' }} onChange={onChange} />)
    })

    act(() => {
      emitQuickOrderParamsChange({
        params: { side: 'sell' },
        panelId: 'other-panel',
        widgetKey: 'quick_order',
      })
      emitQuickOrderParamsChange({
        params: { side: 'sell' },
        panelId: 'panel-1',
        widgetKey: 'quick_order',
      })
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ provider: 'alpaca', side: 'sell' })
  })

  it('uses null event values to clear stale persisted selections', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <Harness
          params={{
            provider: 'alpaca',
            accountId: 'acct-1',
            side: 'buy',
          }}
          onChange={onChange}
        />
      )
    })

    act(() => {
      emitQuickOrderParamsChange({
        params: {
          accountId: null,
          quantity: 10,
          providerParams: { orderClass: 'equity' },
        },
        panelId: 'panel-1',
        widgetKey: 'quick_order',
      })
    })

    expect(onChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      side: 'buy',
    })
  })

  it('merges market data provider updates separately from trading provider settings', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <Harness
          params={{
            provider: 'alpaca',
            marketProvider: 'yahoo-finance',
            marketProviderParams: { region: 'US' },
            marketAuth: { apiKey: 'market-key' },
            accountId: 'acct-1',
            side: 'buy',
          }}
          onChange={onChange}
        />
      )
    })

    act(() => {
      emitQuickOrderParamsChange({
        params: {
          marketProvider: 'finnhub',
          marketProviderParams: null,
          marketAuth: null,
        },
        panelId: 'panel-1',
        widgetKey: 'quick_order',
      })
    })

    expect(onChange).toHaveBeenCalledWith({
      provider: 'alpaca',
      marketProvider: 'finnhub',
      accountId: 'acct-1',
      side: 'buy',
    })
  })
})
