import type { SVGProps } from 'react'
import { createElement } from 'react'
import { List } from 'lucide-react'
import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import type { BlockConfig, SubBlockCondition } from '@/blocks/types'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

const WatchlistIcon = (props: SVGProps<SVGSVGElement>) => createElement(List, props)

const operationCondition = (value: string | string[]): SubBlockCondition => ({
  field: 'operation',
  value,
})

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
      title: 'Watchlist ID',
      type: 'short-input',
      layout: 'full',
      condition: operationCondition(['readListItems', 'addListing', 'removeListing']),
      required: true,
    },
    {
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      condition: operationCondition('addListing'),
      required: true,
    },
    {
      id: 'itemId',
      title: 'Listing Item ID',
      type: 'short-input',
      layout: 'full',
      condition: operationCondition('removeListing'),
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
      description: 'Watchlist ID returned by read lists operation.',
      visibility: 'user-or-llm',
    },
    listing: {
      type: LISTING_IDENTITY_VALUE_TYPE,
      description: 'Structured listing identity.',
      visibility: 'user-or-llm',
    },
    itemId: {
      type: 'string',
      description: 'Listing item ID from the watchlist items array.',
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
