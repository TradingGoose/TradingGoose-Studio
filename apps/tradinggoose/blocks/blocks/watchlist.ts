import type { SVGProps } from 'react'
import { createElement } from 'react'
import { List } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import { WATCHLIST_TOOL_IDS } from '@/tools/watchlist'

const WatchlistIcon = (props: SVGProps<SVGSVGElement>) => createElement(List, props)

export const WatchlistBlock: BlockConfig = {
  type: 'watchlist',
  name: 'Watchlist',
  description: 'Read workspace watchlists and watchlist items.',
  longDescription:
    'Read root workspace watchlists, inspect ordered listing items, and inspect section/category items.',
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
      ],
      value: () => 'readLists',
      required: true,
    },
    {
      id: 'watchlistId',
      title: 'Watchlist',
      type: 'dropdown',
      layout: 'full',
      entityListKind: 'watchlist',
      required: { field: 'operation', value: 'readListItems' },
      condition: { field: 'operation', value: 'readListItems' },
    },
  ],
  tools: {
    access: Object.values(WATCHLIST_TOOL_IDS),
    config: {
      tool: (params) => {
        const operation = params.operation as keyof typeof WATCHLIST_TOOL_IDS
        return WATCHLIST_TOOL_IDS[operation]
      },
      params: ({ operation: _operation, ...params }) => params,
    },
  },
  inputs: {},
  outputs: {
    watchlists: { type: 'array', description: 'Watchlist records.' },
    watchlist: { type: 'json', description: 'Watchlist record.' },
    items: { type: 'array', description: 'Watchlist items in display order.' },
    listings: { type: 'array', description: 'Listing items in the watchlist.' },
    sections: { type: 'array', description: 'Section/category items in the watchlist.' },
  },
}
