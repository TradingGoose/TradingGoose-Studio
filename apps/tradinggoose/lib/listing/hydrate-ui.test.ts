import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateListingUI } from '@/lib/listing/hydrate-ui'
import type { ListingResolved } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentity: vi.fn(),
}))

const mockResolveListingIdentity = vi.mocked(resolveListingIdentity)
const listingIdentity = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}
const resolvedListing: ListingResolved = {
  listingIdentity,
  base: 'AAPL',
  quote: 'USD',
  name: 'Apple Inc.',
  assetClass: 'stock',
}

describe('hydrateListingUI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hydrates market-selector identities with the canonical resolved aggregate', async () => {
    mockResolveListingIdentity.mockResolvedValue(resolvedListing)
    const blocks = {
      block: {
        subBlocks: {
          listing: {
            id: 'listing',
            type: 'market-selector',
            value: listingIdentity,
          },
        },
      },
    }

    const hydrated = await hydrateListingUI(blocks)
    const value = hydrated.block.subBlocks.listing.value

    expect(value).toEqual(resolvedListing)
    expect(value).not.toHaveProperty('listing_id')
    expect(mockResolveListingIdentity).toHaveBeenCalledWith(listingIdentity)
  })

  it('preserves identity-like values in non-listing sub-blocks', async () => {
    const value = { ...listingIdentity, base: 'AAPL', customField: 'keep me' }
    const blocks = {
      block: {
        subBlocks: {
          payload: {
            id: 'payload',
            type: 'tool-input',
            value,
          },
        },
      },
    }

    const hydrated = await hydrateListingUI(blocks)

    expect(hydrated).toBe(blocks)
    expect(hydrated.block.subBlocks.payload.value).toBe(value)
    expect(mockResolveListingIdentity).not.toHaveBeenCalled()
  })
})
