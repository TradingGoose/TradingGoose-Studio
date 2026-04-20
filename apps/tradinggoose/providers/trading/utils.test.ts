import { describe, expect, it } from 'vitest'
import { normalizeAlpacaHoldings } from '@/providers/trading/alpaca/positions'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import { normalizeTradierHoldings } from '@/providers/trading/tradier/positions'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import {
  listingIdentityToTradingSymbol,
  tradingSymbolToListingIdentity,
} from '@/providers/trading/utils'

describe('listingIdentityToTradingSymbol', () => {
  it('maps default listing identities to stock provider symbols', () => {
    const symbol = listingIdentityToTradingSymbol(tradierTradingProviderConfig, {
      listing: {
        listing_id: 'SPY',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })

    expect(symbol).toBe('SPY')
  })

  it('maps crypto listing identities to provider symbols without provider-local wrappers', () => {
    const symbol = listingIdentityToTradingSymbol(alpacaTradingProviderConfig, {
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USD',
        listing_type: 'crypto',
      },
    })

    expect(symbol).toBe('BTC/USD')
  })
})

describe('tradingSymbolToListingIdentity', () => {
  it('maps provider crypto symbols back to listing identities', () => {
    expect(
      tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
        symbol: 'BTC/USD',
        assetClass: 'crypto',
      })
    ).toMatchObject({
      base: 'BTC',
      quote: 'USD',
      assetClass: 'crypto',
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USD',
        listing_type: 'crypto',
      },
    })
  })

  it('maps provider stock symbols back to default listing identities', () => {
    expect(
      tradingSymbolToListingIdentity(tradierTradingProviderConfig, {
        symbol: 'AAPL',
      })
    ).toMatchObject({
      base: 'AAPL',
      quote: 'USD',
      assetClass: 'stock',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
  })
})

describe('provider holdings normalization', () => {
  it('preserves the canonical listing identity for Alpaca positions', () => {
    const snapshot = normalizeAlpacaHoldings([
      {
        symbol: 'BTC/USD',
        asset_class: 'crypto',
        qty: '1.5',
        side: 'long',
      },
    ])

    expect(snapshot.positions[0]?.symbol).toMatchObject({
      base: 'BTC',
      quote: 'USD',
      assetClass: 'crypto',
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USD',
        listing_type: 'crypto',
      },
    })
  })

  it('preserves the canonical listing identity for Tradier positions', () => {
    const snapshot = normalizeTradierHoldings({
      positions: {
        position: {
          symbol: 'SPY',
          quantity: '2',
          cost_basis: '1000',
        },
      },
    })

    expect(snapshot.positions[0]?.symbol).toMatchObject({
      base: 'SPY',
      quote: 'USD',
      assetClass: 'stock',
      listing: {
        listing_id: 'SPY',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
  })
})
