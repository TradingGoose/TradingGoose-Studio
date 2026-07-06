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

  it('does not expose listing mutation inputs', () => {
    expect(WatchlistBlock.inputs).toEqual({})
    expect(WatchlistBlock.subBlocks.some((subBlock) => subBlock.id === 'watchlistId')).toBe(false)
    expect(WatchlistBlock.subBlocks.some((subBlock) => subBlock.id === 'listing')).toBe(false)
    expect(WatchlistBlock.description).not.toMatch(/add|remove/i)
    expect(WatchlistBlock.longDescription).not.toMatch(/add|remove/i)
  })
})
