import type { SVGProps } from 'react'
import { createElement } from 'react'
import { List } from 'lucide-react'
import {
  getListingIdentityKey,
  LISTING_IDENTITY_VALUE_TYPE,
  type ListingResolved,
} from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'
import type { WatchlistListingItem, WatchlistRecord } from '@/lib/watchlists/types'
import type {
  BlockConfig,
  BlockOptionLoaderContext,
  SubBlockCondition,
  SubBlockOption,
} from '@/blocks/types'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

const WatchlistIcon = (props: SVGProps<SVGSVGElement>) => createElement(List, props)

const operationCondition = (value: string | string[]): SubBlockCondition => ({
  field: 'operation',
  value,
})

const loadWatchlists = async (context: BlockOptionLoaderContext): Promise<WatchlistRecord[]> => {
  const workspaceId = context.workspaceId?.trim()
  if (!workspaceId) return []

  const response = await fetch(`/api/watchlists?workspaceId=${encodeURIComponent(workspaceId)}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Failed to load watchlists')
  }

  return ((await response.json()) as { watchlists: WatchlistRecord[] }).watchlists
}

const listingLabel = (listing: WatchlistListingItem) => {
  if (listing.listing.listing_type === 'default') return listing.listing.listing_id
  return `${listing.listing.base_id}/${listing.listing.quote_id}`
}

const listingOptionValue = (item: WatchlistListingItem, resolved?: ListingResolved | null) => {
  const label = listingLabel(item)
  const listing = item.listing
  if (resolved) return resolved

  return {
    ...listing,
    base: listing.listing_type === 'default' ? listing.listing_id : listing.base_id,
    quote: listing.listing_type === 'default' ? null : listing.quote_id,
    name: label,
  }
}

const fetchWatchlistOptions = async (
  _blockId: string,
  _subBlockId: string,
  context: BlockOptionLoaderContext
): Promise<SubBlockOption[]> => (await loadWatchlists(context)).map((watchlist) => {
  const count = watchlist.items.filter((item) => item.type === 'listing').length
  return {
    id: watchlist.id,
    label: watchlist.name,
    searchLabel: `${watchlist.name} ${watchlist.id}`,
    rightLabel: `${count} listing${count === 1 ? '' : 's'}`,
  }
})

const fetchWatchlistListingOptions = async (
  _blockId: string,
  _subBlockId: string,
  context: BlockOptionLoaderContext
): Promise<SubBlockOption[]> => {
  const watchlistId =
    typeof context.contextValues?.watchlistId === 'string' ? context.contextValues.watchlistId : ''
  if (!watchlistId) return []

  const watchlist = (await loadWatchlists(context)).find((entry) => entry.id === watchlistId)
  if (!watchlist) return []

  const listingItems = watchlist.items.filter(
    (item): item is WatchlistListingItem => item.type === 'listing'
  )
  const resolvedListings = await resolveListingIdentities(listingItems.map((item) => item.listing))

  return watchlist.items.flatMap((item) => {
    if (item.type === 'section') {
      return []
    }
    const label = listingLabel(item)
    return [
      {
        id: getListingIdentityKey(item.listing),
        label,
        value: listingOptionValue(item, resolvedListings[getListingIdentityKey(item.listing)]),
      },
    ]
  })
}

export const WatchlistBlock: BlockConfig = {
  type: 'watchlist',
  name: 'Watchlist',
  description: 'Read watchlists and add or remove listing items.',
  longDescription:
    'Read workspace watchlists, inspect items and sections, add listings, and remove listing items.',
  category: 'tools',
  bgColor: '#0f766e',
  icon: WatchlistIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Lists', id: 'readLists' },
        { label: 'Read List Items', id: 'readListItems' },
        { label: 'Add Listing', id: 'addListing' },
        { label: 'Remove Listing', id: 'removeListing' },
      ],
      value: () => 'readLists',
      required: true,
    },
    {
      id: 'watchlistId',
      title: 'Watchlist',
      type: 'dropdown',
      layout: 'full',
      condition: operationCondition(['readListItems', 'addListing', 'removeListing']),
      options: [],
      fetchOptions: fetchWatchlistOptions,
      enableSearch: true,
      searchPlaceholder: 'Search watchlists...',
      placeholder: 'Select watchlist',
      autoSelectFirstOption: false,
      required: true,
    },
    {
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      condition: operationCondition(['addListing', 'removeListing']),
      dependsOn: ['watchlistId'],
      fetchOptionsCondition: operationCondition('removeListing'),
      fetchOptions: fetchWatchlistListingOptions,
      required: true,
    },
  ],
  tools: {
    access: Object.values(WATCHLIST_TOOL_IDS),
    config: {
      tool: (params) => {
        const operation = params.operation as keyof typeof WATCHLIST_TOOL_IDS
        return WATCHLIST_TOOL_IDS[operation] ?? WATCHLIST_TOOL_IDS.readLists
      },
      params: ({ operation: _operation, ...params }) => params,
    },
  },
  inputs: {
    watchlistId: {
      type: 'string',
      description: 'Watchlist selected by the Watchlist field.',
      visibility: 'user-or-llm',
    },
    listing: {
      type: LISTING_IDENTITY_VALUE_TYPE,
      description: 'Structured listing identity.',
      visibility: 'user-or-llm',
    },
  },
  outputs: {
    watchlists: { type: 'array', description: 'Watchlist records.' },
    watchlist: { type: 'json', description: 'Watchlist record.' },
    items: { type: 'array', description: 'Watchlist items in display order.' },
    listings: { type: 'array', description: 'Listing items in the watchlist.' },
    sections: { type: 'array', description: 'Section/category items in the watchlist.' },
  },
}
