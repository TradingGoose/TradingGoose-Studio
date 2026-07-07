import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDashboardLayoutReadProjection } from '@/lib/dashboard-layouts/read-projection'
import { getListingIdentityKey, type ListingIdentity } from '@/lib/listing/identity'
import type { LayoutNode } from '@/widgets/layout'

const mockResolveListingIdentities = vi.hoisted(() => vi.fn())

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentities: mockResolveListingIdentities,
  resolveListingIdentity: vi.fn(),
}))

const identity = (
  listing_type: ListingIdentity['listing_type'],
  listing_id: string,
  base_id = '',
  quote_id = ''
): ListingIdentity => ({ listing_type, listing_id, base_id, quote_id })
const aapl = identity('default', 'AAPL')
const btcUsd = identity('crypto', '', 'BTC', 'USD')
const eurUsd = identity('currency', '', 'EUR', 'USD')

const panel = (id: string, pairColor: 'red' | 'gray', listing?: ListingIdentity): LayoutNode => ({
  id,
  type: 'panel',
  widget: { key: 'data_chart', pairColor, params: listing ? { listing } : null },
})
const resolved = (listing: ListingIdentity, base: string, quote: string | null, name: string) => ({
  [getListingIdentityKey(listing)]: { ...listing, base, quote, name },
})

describe('buildDashboardLayoutReadProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps entityDocument identity-only while hydrating read and effective projections', async () => {
    mockResolveListingIdentities.mockResolvedValue(resolved(aapl, 'Apple', null, 'Apple Inc.'))

    const projection = await buildDashboardLayoutReadProjection({
      name: 'Layout',
      layout: panel('panel-chart', 'red'),
      colorPairs: { pairs: [{ color: 'red', listing: aapl }] },
      isActive: true,
      sortOrder: 0,
    })

    const entityDocument = JSON.parse(projection.entityDocument)
    expect(entityDocument.colorPairs.pairs[0].listing).toEqual(aapl)
    expect(entityDocument.colorPairs.pairs[0].listing.base).toBeUndefined()
    expect(projection.hydratedColorPairs.pairs[0].listing).toMatchObject({
      listing_id: 'AAPL',
      base: 'Apple',
      name: 'Apple Inc.',
    })
    expect(projection.effectiveLayout).toMatchObject({
      type: 'panel',
      widget: { params: { listing: { listing_id: 'AAPL', base: 'Apple', name: 'Apple Inc.' } } },
    })
  })

  it('keeps crypto and currency listing identities canonical while hydrating effective projections', async () => {
    mockResolveListingIdentities.mockResolvedValue({
      ...resolved(btcUsd, 'Bitcoin', 'US Dollar', 'BTC/USD'),
      ...resolved(eurUsd, 'Euro', 'US Dollar', 'EUR/USD'),
    })

    const projection = await buildDashboardLayoutReadProjection({
      name: 'Pairs',
      layout: {
        id: 'root',
        type: 'group',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [panel('panel-local', 'gray', eurUsd), panel('panel-linked', 'red')],
      },
      colorPairs: { pairs: [{ color: 'red', listing: btcUsd }] },
      isActive: true,
      sortOrder: 0,
    })

    expect(mockResolveListingIdentities).toHaveBeenCalledWith([eurUsd, btcUsd])
    const entityDocument = JSON.parse(projection.entityDocument)
    expect(entityDocument.layout.children[0].widget.params.listing).toEqual(eurUsd)
    expect(entityDocument.colorPairs.pairs[0].listing).toEqual(btcUsd)
    expect(entityDocument.layout.children[0].widget.params.listing.base).toBeUndefined()
    expect(entityDocument.colorPairs.pairs[0].listing.base).toBeUndefined()
    expect((projection.hydratedLayout as any).children[0]).toMatchObject({
      widget: { params: { listing: { base: 'Euro', quote: 'US Dollar', name: 'EUR/USD' } } },
    })
    expect((projection.effectiveLayout as any).children[1]).toMatchObject({
      widget: { params: { listing: { base: 'Bitcoin', quote: 'US Dollar', name: 'BTC/USD' } } },
    })
  })
})
