import { describe, expect, it } from 'vitest'
import {
  WATCHLIST_TOOL_IDS,
  watchlistReadListItemsTool,
  watchlistReadListsTool,
} from '@/tools/watchlist'

describe('watchlist tools', () => {
  it('exposes only read-only watchlist tool ids', () => {
    expect(WATCHLIST_TOOL_IDS).toEqual({
      readLists: 'watchlist_read_lists',
      readListItems: 'watchlist_read_list_items',
    })
  })

  it('keeps watchlist tool metadata client-safe', () => {
    expect(watchlistReadListsTool.directExecution).toBeUndefined()
    expect(watchlistReadListItemsTool.directExecution).toBeUndefined()
    expect(watchlistReadListItemsTool.params).toEqual({
      watchlistId: {
        type: 'string',
        required: true,
        description: 'Root watchlist id to read.',
      },
    })
  })
})
