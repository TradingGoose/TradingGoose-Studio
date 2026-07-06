import type {
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export type WatchlistScopedParams = {
  _context?: {
    workspaceId?: string
    isDeployedContext?: boolean
  }
}

export type WatchlistReadListItemsParams = WatchlistScopedParams

export type WatchlistListItemsOutput = {
  watchlist: WatchlistRecord
  items: WatchlistItem[]
  listings: WatchlistListingItem[]
  sections: WatchlistSectionItem[]
}

export type WatchlistListsOutput = {
  watchlists: WatchlistRecord[]
}

type WatchlistToolResponse<T extends Record<string, any>> = ToolResponse & {
  output: T
}

export const WATCHLIST_TOOL_IDS = {
  readLists: 'watchlist_read_lists',
  readListItems: 'watchlist_read_list_items',
} as const

export type WatchlistToolId = (typeof WATCHLIST_TOOL_IDS)[keyof typeof WATCHLIST_TOOL_IDS]

export const isWatchlistToolId = (toolId: string): toolId is WatchlistToolId =>
  Object.values(WATCHLIST_TOOL_IDS).includes(toolId as WatchlistToolId)

const workspaceReadExecution = {
  workspace: { required: true, access: 'read' },
} as const

const noopRequest = {
  url: 'direct://watchlist',
  method: 'GET' as const,
  headers: () => ({}),
}

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
  description: 'Read root watchlists available in the current workspace.',
  version: '1.0.0',
  execution: workspaceReadExecution,
  params: {},
  request: noopRequest,
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
  params: {},
  request: noopRequest,
  outputs: watchlistListItemsOutputs,
}
