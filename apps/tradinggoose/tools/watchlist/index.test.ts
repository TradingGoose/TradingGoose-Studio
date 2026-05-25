import { describe, expect, it } from 'vitest'
import { watchlistAddListingTool, watchlistReadListsTool } from '@/tools/watchlist'

const context = {
  _context: {
    workspaceId: 'workspace-1',
  },
}

const listing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}

describe('watchlist tools', () => {
  it('builds scoped list requests', () => {
    expect(watchlistReadListsTool.request.body?.(context)).toEqual({
      operation: 'readLists',
      workspaceId: 'workspace-1',
    })
  })

  it('builds scoped add-listing requests', () => {
    expect(
      watchlistAddListingTool.request.body?.({
        ...context,
        watchlistId: 'watchlist-1',
        listing,
      })
    ).toEqual({
      operation: 'addListing',
      workspaceId: 'workspace-1',
      watchlistId: 'watchlist-1',
      listing,
    })
  })
})
