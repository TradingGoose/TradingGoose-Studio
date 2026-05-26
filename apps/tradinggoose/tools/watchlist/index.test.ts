import { describe, expect, it } from 'vitest'
import {
  watchlistAddListingTool,
  watchlistReadListItemsTool,
  watchlistReadListsTool,
  watchlistRemoveListingTool,
} from '@/tools/watchlist'

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
const params = { ...context, watchlistId: 'watchlist-1', listing }

const toolUrl = (tool: typeof watchlistAddListingTool | typeof watchlistRemoveListingTool) =>
  typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

describe('watchlist tools', () => {
  it('builds list requests against the canonical watchlists route', () => {
    expect(watchlistReadListsTool.request.url).toBe('/api/watchlists')
    expect(watchlistReadListsTool.request.method).toBe('GET')
    expect(watchlistReadListsTool.request.body).toBeUndefined()
  })

  it('builds scoped add-listing requests', () => {
    expect(toolUrl(watchlistAddListingTool)).toBe('/api/watchlists/watchlist-1/items')
    expect(watchlistAddListingTool.request.body?.(params)).toEqual({
      workspaceId: 'workspace-1',
      action: 'addListing',
      listing,
    })
  })

  it('builds scoped remove-listing requests with listing identity', () => {
    expect(toolUrl(watchlistRemoveListingTool)).toBe('/api/watchlists/watchlist-1/items')
    expect(watchlistRemoveListingTool.request.body?.(params)).toEqual({
      workspaceId: 'workspace-1',
      action: 'removeListing',
      listing,
    })
  })

  it('maps read-list-items from the canonical watchlists response', async () => {
    const response = new Response(
      JSON.stringify({
        watchlists: [
          {
            id: 'watchlist-1',
            items: [
              { id: 'section-1', type: 'section', label: 'Tech' },
              { id: 'listing-1', type: 'listing', listing },
            ],
          },
        ],
      })
    )

    const result = await watchlistReadListItemsTool.transformResponse?.(response, {
      ...params,
    })

    expect(result?.output).toMatchObject({
      watchlist: { id: 'watchlist-1' },
      items: expect.arrayContaining([expect.objectContaining({ id: 'listing-1' })]),
      listings: [expect.objectContaining({ id: 'listing-1' })],
      sections: [expect.objectContaining({ id: 'section-1' })],
    })
  })
})
