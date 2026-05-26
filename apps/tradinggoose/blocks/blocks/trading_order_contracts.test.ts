import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { TradingActionBlock } from '@/blocks/blocks/trading_action'
import { TradingOrderDetailBlock } from '@/blocks/blocks/trading_order_detail'
import { TradingOrderHistoryBlock } from '@/blocks/blocks/trading_order_history'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'
import { orderHistoryTool } from '@/tools/trading/order_history'

describe('trading order block contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes workspace scope on order-history tool and block outputs', () => {
    expect(orderHistoryTool.outputs).toHaveProperty('workspaceId')
    expect(orderHistoryTool.outputs?.history.items?.properties).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        submissionSource: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
    expect(TradingOrderHistoryBlock.outputs).toHaveProperty('workspaceId')
  })

  it('exposes workspace and log provenance on order-detail outputs', () => {
    expect(tradingOrderDetailTool.outputs).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
    expect(TradingOrderDetailBlock.outputs).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
  })

  it('exposes appOrderId on trading action outputs for order-detail chaining', () => {
    expect(TradingActionBlock.outputs).toHaveProperty('appOrderId')
  })

  it('invalidates order type options when the selected listing changes', () => {
    const orderType = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'orderType')

    expect(orderType?.dependsOn).toEqual(['provider', 'listing'])
  })

  it('uses market provider context as the listing provider source', () => {
    const listing = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'listing')

    expect(listing).toMatchObject({
      type: 'market-selector',
      providerType: 'market',
    })
    expect(listing).not.toHaveProperty('providerFieldId')
    expect(listing).not.toHaveProperty('dependsOn')
  })

  it('loads enabled broker provider options from OAuth service availability', async () => {
    const provider = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'provider')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'alpaca-paper': true,
        'tradier-live': false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const options = await provider?.fetchOptions?.('block-1', 'provider', {
      channelId: 'channel-1',
      workflowId: 'workflow-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/oauth/providers?providers=alpaca-live%2Calpaca-paper%2Ctradier-live',
      {
        cache: 'no-store',
      }
    )
    expect(options).toEqual([{ id: 'alpaca', label: 'Alpaca' }])
  })

  it('loads broker account options for the selected provider', async () => {
    const portfolioIdentity = TradingActionBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'portfolioIdentity'
    )
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        options: [
          {
            id: url.includes('provider=alpaca') ? 'alpaca-account' : 'tradier-account',
            label: url.includes('provider=alpaca') ? 'Alpaca Account' : 'Tradier Account',
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const options = await portfolioIdentity?.fetchOptions?.('block-1', 'portfolioIdentity', {
      channelId: 'channel-1',
      workflowId: 'workflow-1',
      contextValues: { provider: 'alpaca' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/providers/trading/portfolio-identities?provider=alpaca',
      {
        cache: 'no-store',
      }
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(options).toEqual([{ id: 'alpaca-account', label: 'Alpaca Account' }])
  })

  it('declares canonical sizing controls directly on the order block', () => {
    const quantity = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'quantity')
    const notional = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'notional')

    expect(quantity?.condition).toEqual(
      expect.objectContaining({
        field: 'orderSizingMode',
        value: ['notional'],
        not: true,
        and: { field: 'provider', value: ['alpaca', 'tradier'] },
      })
    )
    expect(notional?.condition).toEqual(
      expect.objectContaining({
        field: 'orderSizingMode',
        value: ['notional'],
        and: { field: 'provider', value: ['alpaca'] },
      })
    )

    expect(
      evaluateSubBlockConditionValues(quantity?.condition, {
        provider: 'tradier',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockConditionValues(quantity?.condition, {
        provider: 'alpaca',
        orderSizingMode: 'notional',
      })
    ).toBe(false)
  })

  it('serializes trading action sizing as canonical route fields', () => {
    const params = TradingActionBlock.tools.config!.params!({
      portfolioIdentity: {
        providerId: 'tradier',
        tokenAccountId: 'oauth-account-1',
        serviceId: 'tradier-live',
        accountId: 'ACC-1',
      },
      side: 'buy',
      listing: { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
      quantity: '2',
      orderSizingMode: 'notional',
      notional: '100',
    } as any)

    expect(params).toMatchObject({ orderSizingMode: 'notional', notional: 100 })
    expect(params).not.toHaveProperty('quantity')
  })
})
