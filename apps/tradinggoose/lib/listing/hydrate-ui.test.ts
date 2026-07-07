import { describe, expect, it } from 'vitest'
import {
  applyResolvedDashboardListings,
  collectDashboardListingIdentities,
} from '@/lib/listing/hydrate-ui'
import { getListingIdentityKey, type ListingIdentity } from '@/lib/listing/identity'

const identity = (
  listing_type: ListingIdentity['listing_type'],
  listing_id: string,
  base_id = '',
  quote_id = ''
): ListingIdentity => ({ listing_type, listing_id, base_id, quote_id })
const aapl = identity('default', 'AAPL')
const btcUsd = identity('crypto', '', 'BTC', 'USD')
const eurUsd = identity('currency', '', 'EUR', 'USD')

const panel = (pairColor: string, listing: ListingIdentity) => ({
  id: 'panel-chart',
  type: 'panel',
  widget: { key: 'data_chart', pairColor, params: { listing } },
})
const pairs = (listing: ListingIdentity) => ({ pairs: [{ color: 'red', listing }] })
const resolved = (listing: ListingIdentity, base: string, quote: string | null, name: string) => ({
  [getListingIdentityKey(listing)]: { ...listing, base, quote, name },
})

describe('dashboard listing hydration', () => {
  it('dedupes listing identities from layout params and color pairs', () => {
    expect(collectDashboardListingIdentities(panel('red', aapl), pairs(aapl))).toEqual([aapl])
  })

  it('hydrates layout params and color pairs from resolved listing map', () => {
    const hydrated = applyResolvedDashboardListings(
      panel('red', aapl),
      pairs(aapl),
      resolved(aapl, 'Apple', null, 'Apple Inc.')
    )

    expect(hydrated.layout).toMatchObject({
      widget: { params: { listing: { base: 'Apple', name: 'Apple Inc.' } } },
    })
    expect(hydrated.colorPairs.pairs[0].listing).toMatchObject({
      base: 'Apple',
      name: 'Apple Inc.',
    })
  })

  it('collects and hydrates crypto and currency listing identities without changing canonical keys', () => {
    const layout = panel('gray', btcUsd)
    const colorPairs = pairs(eurUsd)

    expect(collectDashboardListingIdentities(layout, colorPairs)).toEqual([btcUsd, eurUsd])

    const hydrated = applyResolvedDashboardListings(layout, colorPairs, {
      ...resolved(btcUsd, 'Bitcoin', 'US Dollar', 'BTC/USD'),
      ...resolved(eurUsd, 'Euro', 'US Dollar', 'EUR/USD'),
    })

    expect(hydrated.layout).toMatchObject({
      widget: {
        params: { listing: { ...btcUsd, base: 'Bitcoin', quote: 'US Dollar', name: 'BTC/USD' } },
      },
    })
    expect(hydrated.colorPairs.pairs[0].listing).toMatchObject({
      ...eurUsd,
      base: 'Euro',
      quote: 'US Dollar',
      name: 'EUR/USD',
    })
  })
})
