import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import type {
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

type WatchlistScopedParams = {
  _context?: { workspaceId?: string }
}

type WatchlistReadListItemsParams = WatchlistScopedParams & { watchlistId: string }
type WatchlistListingParams = WatchlistReadListItemsParams & { listing: unknown }

type WatchlistListItemsOutput = {
  watchlist: WatchlistRecord
  items: WatchlistItem[]
  listings: WatchlistListingItem[]
  sections: WatchlistSectionItem[]
}

type WatchlistListsOutput = {
  watchlists: WatchlistRecord[]
}

type WatchlistToolResponse<T extends Record<string, any>> = ToolResponse & {
  output: T
}

type WatchlistOperation = 'readLists' | 'readListItems' | 'addListing' | 'removeListing'

export const WATCHLIST_TOOL_IDS = {
  readLists: 'watchlist_read_lists',
  readListItems: 'watchlist_read_list_items',
  addListing: 'watchlist_add_listing',
  removeListing: 'watchlist_remove_listing',
} as const satisfies Record<WatchlistOperation, string>

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
})

const readWatchlistsRequest = {
  url: '/api/watchlists',
  method: 'GET' as const,
  headers: jsonHeaders,
}

const resolveWorkspaceId = (params: WatchlistScopedParams, toolId: string) => {
  const workspaceId = params._context?.workspaceId?.trim()
  if (!workspaceId) {
    throw new Error(`${toolId} requires workspace execution context`)
  }
  return workspaceId
}

const watchlistItemsUrl = (watchlistId: string) =>
  `/api/watchlists/${encodeURIComponent(watchlistId)}/items`

const splitWatchlistItems = (items: WatchlistItem[]) => {
  const listings: WatchlistListingItem[] = []
  const sections: WatchlistSectionItem[] = []

  for (const item of items) {
    if (item.type === 'listing') listings.push(item)
    else sections.push(item)
  }

  return { items, listings, sections }
}

const watchlistOutput = (watchlist: WatchlistRecord): WatchlistListItemsOutput => ({
  watchlist,
  ...splitWatchlistItems(watchlist.items),
})

const transformReadListsResponse = async (
  response: Response
): Promise<WatchlistToolResponse<WatchlistListsOutput>> => ({
  success: true,
  output: (await response.json()) as WatchlistListsOutput,
})

const transformReadListItemsResponse = async (
  response: Response,
  params?: WatchlistReadListItemsParams
): Promise<WatchlistToolResponse<WatchlistListItemsOutput>> => {
  const { watchlists } = (await response.json()) as WatchlistListsOutput
  const watchlist = watchlists.find((entry) => entry.id === params?.watchlistId)
  if (!watchlist) throw new Error('Watchlist not found')
  return { success: true, output: watchlistOutput(watchlist) }
}

const transformWatchlistResponse = async (
  response: Response
): Promise<WatchlistToolResponse<WatchlistListItemsOutput>> => {
  const { watchlist } = (await response.json()) as { watchlist: WatchlistRecord }
  return { success: true, output: watchlistOutput(watchlist) }
}

const workspaceReadExecution = {
  workspace: { required: true, access: 'read' },
} as const

const workspaceWriteExecution = {
  workspace: { required: true, access: 'write' },
} as const

const watchlistIdParam = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Watchlist ID returned by Watchlist: Read Lists.',
} as const

const listingParam = {
  type: LISTING_IDENTITY_VALUE_TYPE,
  required: true,
  visibility: 'user-or-llm',
  description: 'Structured TradingGoose listing identity.',
} as const

const watchlistListItemsOutputs = {
  watchlist: { type: 'json', description: 'Watchlist record.' },
  items: {
    type: 'array',
    description: 'Watchlist items in display order, including listings and sections.',
  },
  listings: { type: 'array', description: 'Listing items in the watchlist.' },
  sections: { type: 'array', description: 'Section/category items in the watchlist.' },
} as const

export const watchlistReadListsTool: ToolConfig<
  WatchlistScopedParams,
  WatchlistToolResponse<WatchlistListsOutput>
> = {
  id: WATCHLIST_TOOL_IDS.readLists,
  name: 'Watchlist: Read Lists',
  description: 'Read watchlists available in the current workspace for the executing user.',
  version: '1.0.0',
  execution: workspaceReadExecution,
  params: {},
  request: readWatchlistsRequest,
  transformResponse: transformReadListsResponse,
  outputs: {
    watchlists: {
      type: 'array',
      description: 'Watchlist records including items, settings, and metadata.',
    },
  },
}

export const watchlistReadListItemsTool: ToolConfig<
  WatchlistReadListItemsParams,
  WatchlistToolResponse<WatchlistListItemsOutput>
> = {
  id: WATCHLIST_TOOL_IDS.readListItems,
  name: 'Watchlist: Read List Items',
  description: 'Read one watchlist with ordered listings and section/category items.',
  version: '1.0.0',
  execution: workspaceReadExecution,
  params: {
    watchlistId: watchlistIdParam,
  },
  request: readWatchlistsRequest,
  transformResponse: transformReadListItemsResponse,
  outputs: watchlistListItemsOutputs,
}

const listingMutationTool = (
  operation: 'addListing' | 'removeListing',
  name: string,
  description: string
): ToolConfig<
  WatchlistListingParams,
  WatchlistToolResponse<WatchlistListItemsOutput>
> => ({
  id: WATCHLIST_TOOL_IDS[operation],
  name,
  description,
  version: '1.0.0',
  execution: workspaceWriteExecution,
  params: {
    watchlistId: watchlistIdParam,
    listing: listingParam,
  },
  request: {
    url: (params) => watchlistItemsUrl(params.watchlistId),
    method: 'POST',
    headers: jsonHeaders,
    body: (params) => ({
      workspaceId: resolveWorkspaceId(params, WATCHLIST_TOOL_IDS[operation]),
      action: operation,
      listing: params.listing,
    }),
  },
  transformResponse: transformWatchlistResponse,
  outputs: watchlistListItemsOutputs,
})

export const watchlistAddListingTool = listingMutationTool(
  'addListing',
  'Watchlist: Add Listing',
  'Add a listing to a watchlist.'
)

export const watchlistRemoveListingTool = listingMutationTool(
  'removeListing',
  'Watchlist: Remove Listing',
  'Remove a listing from a watchlist.'
)
