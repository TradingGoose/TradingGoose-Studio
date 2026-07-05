import type { SVGProps } from 'react'
import { createElement } from 'react'
import { List } from 'lucide-react'
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
      condition: operationCondition('readListItems'),
      entityListKind: 'watchlist',
      options: [],
      enableSearch: true,
      searchPlaceholder: 'Search watchlists...',
      placeholder: 'Select watchlist',
      autoSelectFirstOption: false,
      required: true,
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
  inputs: {
    watchlistId: {
      type: 'string',
      description: 'Watchlist selected by the Watchlist field.',
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
