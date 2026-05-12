import { describe, expect, it } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import {
  getQuickOrderOrderTypeDefinitions,
  getQuickOrderSizingModeConfig,
  normalizeQuickOrderNumber,
  resolveQuickOrderOrderType,
} from '@/widgets/widgets/quick_order/components/shared'

const stockListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const cryptoListing: ListingResolved = {
  listing_type: 'crypto' as const,
  listing_id: '',
  base_id: 'BTC',
  quote_id: 'USD',
  base: 'BTC',
  quote: 'USD',
}

const assetlessListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'MSFT',
  base_id: '',
  quote_id: '',
  base: 'MSFT',
  quote: 'USD',
}

const currencyListing: ListingResolved = {
  listing_type: 'currency' as const,
  listing_id: '',
  base_id: 'EUR',
  quote_id: 'USD',
  base: 'EUR',
  quote: 'USD',
}

const futureListing = {
  listing_type: 'default',
  listing_id: 'ES',
  base_id: '',
  quote_id: '',
  base: 'ES',
  quote: 'USD',
  assetClass: 'future',
} as const

const indiceListing = {
  listing_type: 'default',
  listing_id: 'SPX',
  base_id: '',
  quote_id: '',
  base: 'SPX',
  quote: 'USD',
  assetClass: 'indice',
} as const

const mutualFundListing = {
  listing_type: 'default',
  listing_id: 'VTSAX',
  base_id: '',
  quote_id: '',
  base: 'VTSAX',
  quote: 'USD',
  assetClass: 'mutualfund',
} as const

describe('quick order shared helpers', () => {
  it('exposes sizing mode only for providers with a sizing selector', () => {
    expect(getQuickOrderSizingModeConfig('alpaca')).toEqual({
      options: ['quantity', 'notional'],
      defaultMode: 'quantity',
    })
    expect(getQuickOrderSizingModeConfig('tradier')).toEqual({ options: [] })
  })

  it('uses strict order-type filtering and provider defaults', () => {
    expect(
      resolveQuickOrderOrderType({ providerId: 'tradier', listing: stockListing })
    ).toMatchObject({
      ok: true,
      orderType: 'market',
    })
    expect(
      getQuickOrderOrderTypeDefinitions('tradier', cryptoListing).map((definition) => definition.id)
    ).toEqual([])
  })

  it('returns explicit failures for unsupported quick order type states', () => {
    expect(
      resolveQuickOrderOrderType({
        providerId: 'tradier',
        listing: assetlessListing,
      })
    ).toEqual({
      ok: false,
      reason: 'no_supported_order_types',
      options: [],
    })

    expect(
      resolveQuickOrderOrderType({
        providerId: 'tradier',
        listing: stockListing,
        orderType: 'trailing_stop',
      })
    ).toMatchObject({
      ok: false,
      reason: 'unsupported_order_type',
      requestedOrderType: 'trailing_stop',
    })
  })

  it('keeps quick-order order types strict across unsupported asset classes', () => {
    expect(getQuickOrderOrderTypeDefinitions('tradier', assetlessListing)).toEqual([])
    expect(getQuickOrderOrderTypeDefinitions('tradier', currencyListing)).toEqual([])
    expect(getQuickOrderOrderTypeDefinitions('tradier', futureListing)).toEqual([])
    expect(getQuickOrderOrderTypeDefinitions('tradier', indiceListing)).toEqual([])
    expect(getQuickOrderOrderTypeDefinitions('tradier', mutualFundListing)).toEqual([])
  })

  it('parses quick order numbers without treating invalid text as empty', () => {
    expect(normalizeQuickOrderNumber(' 12.5 ')).toEqual({ ok: true, value: 12.5 })
    expect(normalizeQuickOrderNumber('')).toEqual({ ok: true, value: undefined })
    expect(normalizeQuickOrderNumber(Number.NaN)).toEqual({
      ok: false,
      reason: 'invalid_number',
      rawValue: Number.NaN,
    })
    expect(normalizeQuickOrderNumber('abc')).toEqual({
      ok: false,
      reason: 'invalid_number',
      rawValue: 'abc',
    })
  })
})
