import { afterEach, describe, expect, it, vi } from 'vitest'
import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import { WatchlistBlock } from '@/blocks/blocks/watchlist'
import { getToolParametersConfig } from '@/tools/params'
import { tools } from '@/tools/registry'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

const watchlistRecord = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Growth',
  isSystem: false,
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
  items: [
    {
      id: 'listing-1',
      type: 'listing',
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
    },
    { id: 'section-1', type: 'section', label: 'Crypto' },
    {
      id: 'listing-2',
      type: 'listing',
      listing: { listing_id: '', base_id: 'BTC', quote_id: 'USD', listing_type: 'crypto' },
    },
  ],
} as const

describe('WatchlistBlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('uses one market selector and listingIdentity input for add and remove operations', () => {
    const listingSubBlock = WatchlistBlock.subBlocks.find((subBlock) => subBlock.id === 'listing')

    expect(listingSubBlock).toMatchObject({
      type: 'market-selector',
      condition: {
        field: 'operation',
        value: ['addListing', 'removeListing'],
      },
      dependsOn: ['watchlistId'],
      fetchOptionsCondition: {
        field: 'operation',
        value: 'removeListing',
      },
    })
    expect(WatchlistBlock.inputs.listing.type).toBe(LISTING_IDENTITY_VALUE_TYPE)
    expect(WatchlistBlock.inputs).not.toHaveProperty('itemId')
  })

  it('maps remove-listing tool params to the shared market selector UI', () => {
    const params = getToolParametersConfig(WATCHLIST_TOOL_IDS.removeListing, WatchlistBlock)
    const listingParam = params?.userInputParameters.find((param) => param.id === 'listing')

    expect(params?.userInputParameters.map((param) => param.id)).toEqual(['watchlistId', 'listing'])
    expect(listingParam?.uiComponent).toMatchObject({
      type: 'market-selector',
      subBlockId: 'listing',
      fetchOptionsCondition: {
        field: 'operation',
        value: 'removeListing',
      },
    })
  })

  it('loads named watchlist options instead of requiring raw IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ watchlists: [watchlistRecord] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const watchlistSubBlock = WatchlistBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'watchlistId'
    )

    expect(watchlistSubBlock).toMatchObject({
      title: 'Watchlist',
      type: 'dropdown',
      enableSearch: true,
      autoSelectFirstOption: false,
    })

    const options = await watchlistSubBlock?.fetchOptions?.('block-1', 'watchlistId', {
      channelId: 'channel-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/watchlists?workspaceId=workspace-1', {
      cache: 'no-store',
    })
    expect(options).toEqual([
      {
        id: 'watchlist-1',
        label: 'Growth',
        searchLabel: 'Growth watchlist-1',
        rightLabel: '2 listings',
      },
    ])
  })

  it('loads remove-listing candidates from the selected watchlist as resolved listings', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/watchlists')) {
        return {
          ok: true,
          json: async () => ({ watchlists: [watchlistRecord] }),
        }
      }
      if (url.includes('/api/market/get/listing')) {
        return new Response(
          JSON.stringify({
            data: {
              base: 'AAPL',
              name: 'Apple Inc.',
              iconUrl: '/aapl.svg',
              assetClass: 'stock',
            },
          }),
          { status: 200 }
        )
      }
      if (url.includes('/api/market/get/crypto')) {
        return new Response(
          JSON.stringify({
            data: {
              code: 'BTC',
              name: 'Bitcoin',
              iconUrl: '/btc.svg',
            },
          }),
          { status: 200 }
        )
      }
      if (url.includes('/api/market/get/currency')) {
        return new Response(
          JSON.stringify({
            data: {
              code: 'USD',
              name: 'US Dollar',
            },
          }),
          { status: 200 }
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const listingSubBlock = WatchlistBlock.subBlocks.find((subBlock) => subBlock.id === 'listing')

    expect(listingSubBlock).toMatchObject({
      title: 'Listing',
      type: 'market-selector',
      dependsOn: ['watchlistId'],
    })

    const options = await listingSubBlock?.fetchOptions?.('block-1', 'listing', {
      channelId: 'channel-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      contextValues: { watchlistId: 'watchlist-1' },
    })

    expect(options).toMatchObject([
      {
        id: 'default|AAPL||',
        label: 'AAPL',
        group: 'Listings',
        searchLabel: 'AAPL listing-1 AAPL',
        rightLabel: 'default',
        value: {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
          base: 'AAPL',
          quote: null,
          name: 'Apple Inc.',
          iconUrl: '/aapl.svg',
          assetClass: 'stock',
        },
      },
      {
        id: 'crypto||BTC|USD',
        label: 'BTC/USD',
        group: 'Crypto',
        searchLabel: 'BTC/USD listing-2 BTC USD',
        rightLabel: 'crypto',
        value: {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USD',
          listing_type: 'crypto',
          base: 'BTC',
          quote: 'USD',
          name: 'Bitcoin to US Dollar pair',
          iconUrl: '/btc.svg',
          assetClass: 'crypto',
        },
      },
    ])
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
