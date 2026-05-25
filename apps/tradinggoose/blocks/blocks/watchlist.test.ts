import { describe, expect, it } from 'vitest'
import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import { WatchlistBlock } from '@/blocks/blocks/watchlist'
import { tools } from '@/tools/registry'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

describe('WatchlistBlock', () => {
  it('maps every operation option to a registered tool', () => {
    const operationSubBlock = WatchlistBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'operation'
    )
    const options = Array.isArray(operationSubBlock?.options) ? operationSubBlock.options : []

    expect(options.length).toBe(Object.keys(WATCHLIST_TOOL_IDS).length)

    for (const option of options) {
      const toolId = WatchlistBlock.tools.config?.tool({ operation: option.id })
      expect(toolId).toBe(WATCHLIST_TOOL_IDS[option.id as keyof typeof WATCHLIST_TOOL_IDS])
      expect(tools[toolId!]).toBeDefined()
    }
  })

  it('uses a market selector and listingIdentity input for listing operations', () => {
    const listingSubBlock = WatchlistBlock.subBlocks.find((subBlock) => subBlock.id === 'listing')

    expect(listingSubBlock).toMatchObject({
      type: 'market-selector',
      condition: {
        field: 'operation',
        value: 'addListing',
      },
    })
    expect(WatchlistBlock.inputs.listing.type).toBe(LISTING_IDENTITY_VALUE_TYPE)
  })

  it('exposes section/category outputs for read operations', () => {
    expect(WatchlistBlock.outputs).toEqual(
      expect.objectContaining({
        items: expect.any(Object),
        listings: expect.any(Object),
        sections: expect.any(Object),
      })
    )
  })
})
