import { describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { HistoricalDataBlock } from '@/blocks/blocks/historical_data'
import { TradingActionBlock } from '@/blocks/blocks/trading_action'
import { TradingHoldingsBlock } from '@/blocks/blocks/trading_holdings'
import { TradingOrderDetailBlock } from '@/blocks/blocks/trading_order_detail'
import { TradingOrderHistoryBlock } from '@/blocks/blocks/trading_order_history'
import { getToolParametersConfig } from '@/tools/params'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'
import { orderHistoryTool } from '@/tools/trading/order_history'

describe('trading order block contracts', () => {
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

  it('uses route market provider context and selected broker as listing filters', () => {
    const listing = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'listing')
    const toolParams = getToolParametersConfig(
      'trading_place_order',
      TradingActionBlock
    )?.userInputParameters

    expect(listing).toMatchObject({
      type: 'market-selector',
      providerType: 'market',
      tradingProviderFieldId: 'provider',
      dependsOn: ['provider'],
    })
    expect(
      toolParams
        ?.slice(0, 3)
        .map((param) => [
          param.id,
          param.required,
          param.uiComponent?.subBlockId,
          param.uiComponent?.providerType,
          param.uiComponent?.tradingProviderFieldId,
          param.uiComponent?.dependsOn,
        ])
    ).toEqual([
      ['provider', true, 'provider', undefined, undefined, undefined],
      ['portfolioIdentity', true, 'portfolioIdentity', undefined, 'provider', ['provider']],
      ['listing', true, 'listing', 'market', 'provider', ['provider']],
    ])
  })

  it('uses canonical broker provider and account selector sub-blocks', () => {
    const provider = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'provider')
    const portfolioIdentity = TradingActionBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'portfolioIdentity'
    )

    expect(provider).toMatchObject({
      type: 'trading-provider-selector',
      tradingProviderKind: 'order',
      required: true,
    })
    expect(provider?.fetchOptions).toBeUndefined()
    expect(portfolioIdentity).toMatchObject({
      type: 'trading-account-selector',
      tradingProviderFieldId: 'provider',
      dependsOn: ['provider'],
      autoSelectFirstOption: false,
      required: true,
    })
    expect(portfolioIdentity?.fetchOptions).toBeUndefined()
  })

  it('uses canonical provider selectors on related market and holdings blocks', () => {
    expect(
      TradingHoldingsBlock.subBlocks.find((subBlock) => subBlock.id === 'provider')
    ).toMatchObject({
      type: 'trading-provider-selector',
      tradingProviderKind: 'holdings',
    })
    expect(
      TradingHoldingsBlock.subBlocks.find((subBlock) => subBlock.id === 'portfolioIdentity')
    ).toMatchObject({
      type: 'trading-account-selector',
      tradingProviderFieldId: 'provider',
    })
    expect(
      HistoricalDataBlock.subBlocks.find((subBlock) => subBlock.id === 'provider')
    ).toMatchObject({
      type: 'market-provider-selector',
      marketProviderKind: 'series',
    })
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
        credentialId: 'oauth-account-1',
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
