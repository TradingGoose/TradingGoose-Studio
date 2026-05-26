import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import type {
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

type WatchlistToolContext = {
  workspaceId?: string
}

interface WatchlistScopedParams {
  _context?: WatchlistToolContext
}

export interface WatchlistReadListItemsParams extends WatchlistScopedParams {
  watchlistId: string
}

export interface WatchlistAddListingParams extends WatchlistScopedParams {
  watchlistId: string
  listing: unknown
}

export interface WatchlistRemoveListingParams extends WatchlistScopedParams {
  watchlistId: string
  listing: unknown
}

export type WatchlistListItemsOutput = {
  watchlist: WatchlistRecord
  items: WatchlistItem[]
  listings: WatchlistListingItem[]
  sections: WatchlistSectionItem[]
}

export type WatchlistListsOutput = {
  watchlists: WatchlistRecord[]
}

type WatchlistApiResponse<T> = {
  success: boolean
  data: T
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

const watchlistToolUrl = '/api/tools/watchlists'

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
})

const resolveWorkspaceId = (params: WatchlistScopedParams, toolId: string) => {
  const workspaceId = params._context?.workspaceId?.trim()
  if (!workspaceId) {
    throw new Error(`${toolId} requires workspace execution context`)
  }
  return workspaceId
}

const scopedBody = (
  operation: WatchlistOperation,
  params: WatchlistScopedParams,
  payload: Record<string, unknown> = {}
) => ({
  operation,
  workspaceId: resolveWorkspaceId(params, WATCHLIST_TOOL_IDS[operation]),
  ...payload,
})

const transformWatchlistResponse =
  <T extends Record<string, any>>() =>
  async (response: Response): Promise<WatchlistToolResponse<T>> => {
    const result = (await response.json()) as WatchlistApiResponse<T>
    return {
      success: true,
      output: result.data,
    }
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
  request: {
    url: watchlistToolUrl,
    method: 'POST',
    headers: jsonHeaders,
    body: (params) => scopedBody('readLists', params),
  },
  transformResponse: transformWatchlistResponse<WatchlistListsOutput>(),
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
  request: {
    url: watchlistToolUrl,
    method: 'POST',
    headers: jsonHeaders,
    body: (params) => scopedBody('readListItems', params, { watchlistId: params.watchlistId }),
  },
  transformResponse: transformWatchlistResponse<WatchlistListItemsOutput>(),
  outputs: watchlistListItemsOutputs,
}

export const watchlistAddListingTool: ToolConfig<
  WatchlistAddListingParams,
  WatchlistToolResponse<WatchlistListItemsOutput>
> = {
  id: WATCHLIST_TOOL_IDS.addListing,
  name: 'Watchlist: Add Listing',
  description: 'Add a listing to a watchlist.',
  version: '1.0.0',
  execution: workspaceWriteExecution,
  params: {
    watchlistId: watchlistIdParam,
    listing: {
      type: LISTING_IDENTITY_VALUE_TYPE,
      required: true,
      visibility: 'user-or-llm',
      description: 'Structured TradingGoose listing identity to add.',
    },
  },
  request: {
    url: watchlistToolUrl,
    method: 'POST',
    headers: jsonHeaders,
    body: (params) =>
      scopedBody('addListing', params, {
        watchlistId: params.watchlistId,
        listing: params.listing,
      }),
  },
  transformResponse: transformWatchlistResponse<WatchlistListItemsOutput>(),
  outputs: watchlistListItemsOutputs,
}

export const watchlistRemoveListingTool: ToolConfig<
  WatchlistRemoveListingParams,
  WatchlistToolResponse<WatchlistListItemsOutput>
> = {
  id: WATCHLIST_TOOL_IDS.removeListing,
  name: 'Watchlist: Remove Listing',
  description: 'Remove a listing from a watchlist.',
  version: '1.0.0',
  execution: workspaceWriteExecution,
  params: {
    watchlistId: watchlistIdParam,
    listing: {
      type: LISTING_IDENTITY_VALUE_TYPE,
      required: true,
      visibility: 'user-or-llm',
      description: 'Structured TradingGoose listing identity to remove.',
    },
  },
  request: {
    url: watchlistToolUrl,
    method: 'POST',
    headers: jsonHeaders,
    body: (params) =>
      scopedBody('removeListing', params, {
        watchlistId: params.watchlistId,
        listing: params.listing,
      }),
  },
  transformResponse: transformWatchlistResponse<WatchlistListItemsOutput>(),
  outputs: watchlistListItemsOutputs,
}
