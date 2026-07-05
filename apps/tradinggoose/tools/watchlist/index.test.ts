import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WATCHLIST_TOOL_IDS,
  watchlistReadListItemsTool,
  watchlistReadListsTool,
} from '@/tools/watchlist'

const readSavedEntityListFieldsForExecution = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readSavedEntityListFieldsForExecution,
}))

const listing = {
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
}

const context = {
  _context: {
    workspaceId: 'workspace-1',
    isDeployedContext: false,
  },
}

describe('watchlist tools', () => {
  beforeEach(() => {
    readSavedEntityListFieldsForExecution.mockReset()
    readSavedEntityListFieldsForExecution.mockResolvedValue([
      {
        entityId: 'watchlist-1',
        entityName: 'Growth',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        fields: {
          name: 'Growth',
          settings: {
            showLogo: true,
            showTicker: true,
            showDescription: true,
          },
          items: [
            { id: 'section-1', type: 'section', label: 'Tech' },
            { id: 'listing-1', type: 'listing', listing },
          ],
        },
      },
    ])
  })

  it('exposes only read-only watchlist tool ids', () => {
    expect(WATCHLIST_TOOL_IDS).toEqual({
      readLists: 'watchlist_read_lists',
      readListItems: 'watchlist_read_list_items',
    })
  })

  it('reads watchlists through saved-entity execution helpers', async () => {
    const result = await watchlistReadListsTool.directExecution?.(context)

    expect(readSavedEntityListFieldsForExecution).toHaveBeenCalledWith(
      'watchlist',
      'workspace-1',
      false
    )
    expect(result?.output.watchlists).toEqual([
      {
        id: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Growth',
        settings: {
          showLogo: true,
          showTicker: true,
          showDescription: true,
        },
        items: [
          { id: 'section-1', type: 'section', label: 'Tech' },
          { id: 'listing-1', type: 'listing', listing },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ])
  })

  it('splits one watchlist document into items, listings, and sections', async () => {
    const result = await watchlistReadListItemsTool.directExecution?.({
      ...context,
      watchlistId: 'watchlist-1',
    })

    expect(result?.output).toMatchObject({
      watchlist: { id: 'watchlist-1', name: 'Growth' },
      items: expect.arrayContaining([expect.objectContaining({ id: 'listing-1' })]),
      listings: [expect.objectContaining({ id: 'listing-1' })],
      sections: [expect.objectContaining({ id: 'section-1' })],
    })
  })
})
