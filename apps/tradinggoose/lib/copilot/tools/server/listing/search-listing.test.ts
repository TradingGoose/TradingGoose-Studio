import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import { searchListingServerTool } from '@/lib/copilot/tools/server/listing/search-listing'
import { fetchListings } from '@/lib/listing/search'

vi.mock('@/lib/listing/search', () => ({
  fetchListings: vi.fn(),
}))

const mockFetchListings = vi.mocked(fetchListings)

describe('searchListingServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns resolved listings containing canonical listing identities', async () => {
    const signal = new AbortController().signal
    const listing = {
      listingIdentity: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default' as const,
      },
      base: 'AAPL',
      quote: null,
      name: 'Apple Inc.',
      iconUrl: 'https://example.com/apple.png',
      assetClass: 'stock',
    }
    mockFetchListings.mockResolvedValue([listing, listing])

    const result = await searchListingServerTool.execute(
      { query: '  Apple  ' },
      { userId: 'user-1', signal }
    )

    expect(result).toEqual({ results: [listing] })
    expect(ToolResultSchemas.search_listing.parse(result)).toEqual(result)
    expect(() =>
      ToolResultSchemas.search_listing.parse({
        results: [{ ...listing, listing_id: 'AAPL' }],
      })
    ).toThrow()
    expect(mockFetchListings).toHaveBeenCalledWith({ search_query: 'Apple' }, signal)
  })

  it('rejects blank queries before calling the listing search helper', async () => {
    await expect(searchListingServerTool.execute({ query: '   ' })).rejects.toThrow(
      'query is required'
    )
    expect(mockFetchListings).not.toHaveBeenCalled()
  })

  it('maps listing backend failures to a structured retryable tool error', async () => {
    mockFetchListings.mockRejectedValue(new Error('backend unavailable'))

    await expect(searchListingServerTool.execute({ query: 'AAPL' })).rejects.toMatchObject({
      status: 502,
      code: 'search_listing_backend_failed',
      retryable: true,
      hint: expect.stringContaining('listingIdentity under the listing key'),
    })
  })
})
