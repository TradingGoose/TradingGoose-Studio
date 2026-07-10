import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchListingServerTool } from '@/lib/copilot/tools/server/listing/search-listing'
import { searchListingIdentities } from '@/lib/listing/search'

vi.mock('@/lib/listing/search', () => ({
  searchListingIdentities: vi.fn(),
}))

const mockSearchListingIdentities = vi.mocked(searchListingIdentities)

describe('searchListingServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only canonical listing identities from the shared listing search helper', async () => {
    const signal = new AbortController().signal
    const listings = [
      {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default' as const,
      },
    ]
    mockSearchListingIdentities.mockResolvedValue(listings)

    await expect(
      searchListingServerTool.execute({ query: '  Apple  ' }, { userId: 'user-1', signal })
    ).resolves.toEqual(listings)

    expect(mockSearchListingIdentities).toHaveBeenCalledWith('Apple', signal)
  })

  it('rejects blank queries before calling the listing search helper', async () => {
    await expect(searchListingServerTool.execute({ query: '   ' })).rejects.toThrow(
      'query is required'
    )
    expect(mockSearchListingIdentities).not.toHaveBeenCalled()
  })

  it('maps listing backend failures to a structured retryable tool error', async () => {
    mockSearchListingIdentities.mockRejectedValue(new Error('backend unavailable'))

    await expect(searchListingServerTool.execute({ query: 'AAPL' })).rejects.toMatchObject({
      status: 502,
      code: 'search_listing_backend_failed',
      retryable: true,
      hint: expect.stringContaining('under the listing key'),
    })
  })
})
