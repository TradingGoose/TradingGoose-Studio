import { describe, expect, it } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import {
  isTradingOrderListingSupported,
  listingIdentityToTradingSymbol,
  resolveTradingListingAssetClass,
  tradingSymbolToListingIdentity,
} from '@/providers/trading/utils'

const stockListing: ListingResolved = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const etfListing: ListingResolved = {
  listing_type: 'default',
  listing_id: 'SPY',
  base_id: '',
  quote_id: '',
  base: 'SPY',
  quote: 'USD',
  assetClass: 'etf',
}

const assetlessListing: ListingResolved = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
}

describe('trading listing utility helpers', () => {
  it('resolves asset class from enriched listing fields without equity remapping', () => {
    expect(resolveTradingListingAssetClass(assetlessListing)).toBeUndefined()
    expect(resolveTradingListingAssetClass(stockListing)).toBe('stock')
    expect(resolveTradingListingAssetClass(stockListing, 'etf')).toBe('etf')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'crypto',
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USD',
      })
    ).toBe('crypto')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'currency',
        listing_id: '',
        base_id: 'EUR',
        quote_id: 'USD',
      })
    ).toBe('currency')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'default',
        listing_id: 'ES',
        base_asset_class: 'future',
      } as any)
    ).toBe('future')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'default',
        listing_id: 'SPX',
        assetClass: 'indice',
      } as any)
    ).toBe('indice')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'default',
        listing_id: 'VTSAX',
        assetClass: 'mutualfund',
      } as any)
    ).toBe('mutualfund')
    expect(
      resolveTradingListingAssetClass({
        listing_type: 'default',
        listing_id: 'SPX',
        assetClass: 'us_equity',
      } as any)
    ).toBeUndefined()
    expect(resolveTradingListingAssetClass({ listing_type: 'equity' } as any)).toBeUndefined()
  })

  it('validates provider support only after an asset class can be resolved', () => {
    expect(isTradingOrderListingSupported('alpaca', stockListing)).toBe(true)
    expect(isTradingOrderListingSupported('alpaca', etfListing)).toBe(false)
    expect(isTradingOrderListingSupported('alpaca', assetlessListing)).toBe(true)
    expect(
      isTradingOrderListingSupported('alpaca', {
        listing_type: 'crypto',
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USD',
      })
    ).toBe(true)
    expect(
      isTradingOrderListingSupported('tradier', {
        listing_type: 'currency',
        listing_id: '',
        base_id: 'EUR',
        quote_id: 'USD',
      })
    ).toBe(false)
    expect(
      isTradingOrderListingSupported('tradier', {
        listing_type: 'default',
        listing_id: 'ES',
        assetClass: 'future',
      } as any)
    ).toBe(false)
  })

  it('keeps generic symbol conversion independent from quick-order asset-class strictness', () => {
    expect(
      listingIdentityToTradingSymbol(alpacaTradingProviderConfig, {
        listing: {
          listing_type: 'default',
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
        },
      })
    ).toBe('AAPL')

    expect(
      listingIdentityToTradingSymbol(alpacaTradingProviderConfig, {
        listing: {
          listing_type: 'crypto',
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USD',
        },
        assetClass: 'crypto',
      })
    ).toBe('BTC/USD')

    expect(
      tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
        symbol: 'BTC/USD',
        assetClass: 'crypto',
      })
    ).toMatchObject({
      listing: {
        listing_type: 'crypto',
        base_id: 'BTC',
        quote_id: 'USD',
      },
      assetClass: 'crypto',
    })

    expect(
      tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
        symbol: 'DOGEUSD',
        assetClass: 'crypto',
      })
    ).toMatchObject({
      listing: {
        listing_type: 'crypto',
        base_id: 'DOGE',
        quote_id: 'USD',
      },
      base: 'DOGE',
      quote: 'USD',
      assetClass: 'crypto',
    })

    expect(
      tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
        symbol: 'BTCUSDT',
        assetClass: 'crypto',
      })
    ).toMatchObject({
      listing: {
        listing_type: 'crypto',
        base_id: 'BTC',
        quote_id: 'USDT',
      },
      base: 'BTC',
      quote: 'USDT',
      assetClass: 'crypto',
    })

    expect(
      tradingSymbolToListingIdentity(alpacaTradingProviderConfig, {
        symbol: 'SOLUSD',
        assetClass: 'crypto',
      })
    ).toMatchObject({
      listing: {
        listing_type: 'crypto',
        base_id: 'SOL',
        quote_id: 'USD',
      },
      base: 'SOL',
      quote: 'USD',
      assetClass: 'crypto',
    })
  })
})
