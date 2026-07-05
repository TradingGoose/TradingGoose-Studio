import type { EntityListMember } from '@/lib/yjs/entity-session'
import { normalizePersistedWatchlistDocumentFields } from '@/lib/watchlists/document'
import type {
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

type WatchlistScopedParams = {
  _context?: {
    workspaceId?: string
    isDeployedContext?: boolean
  }
}

type WatchlistReadListItemsParams = WatchlistScopedParams & { watchlistId: string }

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

export const WATCHLIST_TOOL_IDS = {
  readLists: 'watchlist_read_lists',
  readListItems: 'watchlist_read_list_items',
} as const

type WatchlistEntityListEntry = EntityListMember & {
  fields: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

const workspaceReadExecution = {
  workspace: { required: true, access: 'read' },
} as const

const noopRequest = {
  url: 'direct://watchlist',
  method: 'GET' as const,
  headers: () => ({}),
}

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

const resolveWorkspaceId = (params: WatchlistScopedParams, toolId: string) => {
  const workspaceId = params._context?.workspaceId?.trim()
  if (!workspaceId) {
    throw new Error(`${toolId} requires workspace execution context`)
  }
  return workspaceId
}

const splitWatchlistItems = (items: WatchlistItem[]) => {
  const listings: WatchlistListingItem[] = []
  const sections: WatchlistSectionItem[] = []

  for (const item of items) {
    if (item.type === 'listing') listings.push(item)
    else sections.push(item)
  }

  return { items, listings, sections }
}

const readWatchlistEntries = async (
  params: WatchlistScopedParams
): Promise<WatchlistEntityListEntry[]> => {
  const workspaceId = resolveWorkspaceId(params, WATCHLIST_TOOL_IDS.readLists)
  const { readSavedEntityListFieldsForExecution } = await import(
    '@/lib/yjs/server/bootstrap-review-target'
  )

  return readSavedEntityListFieldsForExecution(
    'watchlist',
    workspaceId,
    params._context?.isDeployedContext !== false
  ) as Promise<WatchlistEntityListEntry[]>
}

const normalizeWatchlistEntry = (
  entry: WatchlistEntityListEntry,
  workspaceId: string
): WatchlistRecord => {
  const fields = normalizePersistedWatchlistDocumentFields(entry.fields)
  return {
    id: entry.entityId,
    workspaceId,
    name: fields.name,
    settings: fields.settings,
    items: fields.items,
    createdAt: entry.createdAt ?? '',
    updatedAt: entry.updatedAt ?? '',
  }
}

const watchlistOutput = (watchlist: WatchlistRecord): WatchlistListItemsOutput => ({
  watchlist,
  ...splitWatchlistItems(watchlist.items),
})

async function readWatchlists(params: WatchlistScopedParams): Promise<WatchlistRecord[]> {
  const workspaceId = resolveWorkspaceId(params, WATCHLIST_TOOL_IDS.readLists)
  const entries = await readWatchlistEntries(params)
  return entries.map((entry) => normalizeWatchlistEntry(entry, workspaceId))
}

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
  directExecution: async (params) => ({
    success: true,
    output: {
      watchlists: await readWatchlists(params),
    },
  }),
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
  request: noopRequest,
  directExecution: async (params) => {
    const watchlist = (await readWatchlists(params)).find((entry) => entry.id === params.watchlistId)
    if (!watchlist) {
      throw new Error(`Watchlist not found: ${params.watchlistId}`)
    }

    return {
      success: true,
      output: watchlistOutput(watchlist),
    }
  },
  outputs: watchlistListItemsOutputs,
}
