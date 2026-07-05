import { describe, expect, it } from 'vitest'
import { WatchlistBlock } from '@/blocks/blocks/watchlist'
import { tools } from '@/tools/registry'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

describe('WatchlistBlock', () => {
  it('maps every read-only operation option to a registered tool', () => {
    const operationSubBlock = WatchlistBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'operation'
    )
    const options = Array.isArray(operationSubBlock?.options) ? operationSubBlock.options : []
    const toolIds = options.map((option) =>
      WatchlistBlock.tools.config?.tool({ operation: option.id })
    )

    expect(options.map((option) => option.id)).toEqual(['readLists', 'readListItems'])
    expect(toolIds).toEqual(Object.values(WATCHLIST_TOOL_IDS))
    expect(toolIds.every((toolId) => toolId && tools[toolId])).toBe(true)
  })

  it('uses a Yjs entity-list dropdown for selecting watchlists', () => {
    const watchlistSubBlock = WatchlistBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'watchlistId'
    )

    expect(watchlistSubBlock).toMatchObject({
      title: 'Watchlist',
      type: 'dropdown',
      entityListKind: 'watchlist',
      enableSearch: true,
      autoSelectFirstOption: false,
      condition: {
        field: 'operation',
        value: 'readListItems',
      },
    })
    expect(watchlistSubBlock?.fetchOptions).toBeUndefined()
    expect(watchlistSubBlock).not.toHaveProperty('excludeCurrentEntity')
    expect(watchlistSubBlock).not.toHaveProperty('rightLabel')
  })

  it('does not expose listing mutation inputs', () => {
    expect(WatchlistBlock.inputs).toEqual({
      watchlistId: expect.objectContaining({
        type: 'string',
      }),
    })
    expect(WatchlistBlock.subBlocks.some((subBlock) => subBlock.id === 'listing')).toBe(false)
    expect(WatchlistBlock.description).not.toMatch(/add|remove/i)
    expect(WatchlistBlock.longDescription).not.toMatch(/add|remove/i)
  })
})
