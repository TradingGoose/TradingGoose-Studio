import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  watchlistItem: {
    id: 'watchlist_item.id',
    watchlistId: 'watchlist_item.watchlist_id',
    containerId: 'watchlist_item.container_id',
    listing: 'watchlist_item.listing',
    sortOrder: 'watchlist_item.sort_order',
    createdAt: 'watchlist_item.created_at',
  },
  watchlistTable: {
    id: 'watchlist_table.id',
    workspaceId: 'watchlist_table.workspace_id',
    userId: 'watchlist_table.user_id',
    parentId: 'watchlist_table.parent_id',
    name: 'watchlist_table.name',
    sortOrder: 'watchlist_table.sort_order',
    isSystem: 'watchlist_table.is_system',
    settings: 'watchlist_table.settings',
    createdAt: 'watchlist_table.created_at',
    updatedAt: 'watchlist_table.updated_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  asc: vi.fn((value: unknown) => ({ kind: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ kind: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ kind: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
}))

import { addListingToWatchlist, appendWatchlistItemsToWatchlist } from '@/lib/watchlists/operations'

const scope = {
  workspaceId: 'workspace-1',
  userId: 'user-1',
}

const createWatchlistRow = () => ({
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  parentId: null,
  name: 'Default',
  sortOrder: 0,
  isSystem: true,
  settings: {},
  createdAt: new Date('2026-03-17T10:00:00.000Z'),
  updatedAt: new Date('2026-03-17T10:00:00.000Z'),
})

const createSectionRow = (id: string, name: string, sortOrder: number) => ({
  id,
  workspaceId: 'workspace-1',
  userId: 'user-1',
  parentId: 'watchlist-1',
  name,
  sortOrder,
  isSystem: false,
  settings: {},
  createdAt: new Date('2026-03-17T10:10:00.000Z'),
  updatedAt: new Date('2026-03-17T10:10:00.000Z'),
})

const createItemRow = ({
  id,
  listing,
  containerId = null,
  sortOrder,
  createdAt,
}: {
  id: string
  listing: {
    listing_id: string
    base_id: string
    quote_id: string
    listing_type: 'default' | 'crypto' | 'currency'
  }
  containerId?: string | null
  sortOrder: number
  createdAt: string
}) => ({
  id,
  watchlistId: 'watchlist-1',
  containerId,
  listing,
  sortOrder,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
})

const createQueryChain = (result: unknown) => {
  const chain: any = {}

  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)

  return chain
}

const setupTransaction = ({
  selectResults,
  updatedRow,
  insertValues,
}: {
  selectResults: unknown[]
  updatedRow: ReturnType<typeof createWatchlistRow>
  insertValues: ReturnType<typeof vi.fn>
}) => {
  const pendingSelects = [...selectResults]
  const tx: any = {
    select: vi.fn(() => {
      if (pendingSelects.length === 0) {
        throw new Error('Unexpected select call')
      }
      return createQueryChain(pendingSelects.shift())
    }),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    update: vi.fn(() => {
      const chain: any = {}
      chain.set = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.returning = vi.fn().mockResolvedValue([updatedRow])
      return chain
    }),
  }

  mockTransaction.mockImplementation(async (callback: (innerTx: unknown) => unknown) => callback(tx))
}

describe('watchlist operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prepends new root listings before existing root rows', async () => {
    const watchlistRow = createWatchlistRow()
    const updatedRow = {
      ...watchlistRow,
      updatedAt: new Date('2026-03-17T11:00:00.000Z'),
    }
    const sectionRow = createSectionRow('section-1', 'Tech', 0)
    const existingApple = createItemRow({
      id: 'item-a',
      listing: {
        listing_id: 'aapl-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 2,
      createdAt: '2026-03-17T10:15:00.000Z',
    })
    const existingMicrosoft = createItemRow({
      id: 'item-b',
      listing: {
        listing_id: 'msft-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 5,
      createdAt: '2026-03-17T10:20:00.000Z',
    })
    const sectionListing = createItemRow({
      id: 'item-c',
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USDT',
        listing_type: 'crypto',
      },
      containerId: 'section-1',
      sortOrder: 0,
      createdAt: '2026-03-17T10:25:00.000Z',
    })
    const insertedListing = createItemRow({
      id: 'item-new',
      listing: {
        listing_id: 'nvda-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 1,
      createdAt: '2026-03-17T10:30:00.000Z',
    })
    const insertValues = vi.fn().mockResolvedValue(undefined)

    setupTransaction({
      updatedRow,
      insertValues,
      selectResults: [
        [watchlistRow],
        [sectionRow],
        [existingApple, existingMicrosoft, sectionListing],
        [{ sortOrder: 2 }],
        [sectionRow],
        [insertedListing, existingApple, existingMicrosoft, sectionListing],
      ],
    })

    const result = await addListingToWatchlist(scope, 'watchlist-1', {
      listing_id: 'nvda-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })

    expect(insertValues).toHaveBeenCalledWith({
      watchlistId: 'watchlist-1',
      containerId: null,
      listing: {
        listing_id: 'nvda-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 1,
    })
    expect(result.items[0]).toMatchObject({
      type: 'listing',
      listing: {
        listing_id: 'nvda-id',
      },
    })
    expect(result.items[1]).toMatchObject({
      type: 'listing',
      listing: {
        listing_id: 'aapl-id',
      },
    })
    expect(result.items[2]).toMatchObject({
      type: 'listing',
      listing: {
        listing_id: 'msft-id',
      },
    })
    expect(result.items[3]).toMatchObject({
      type: 'section',
      label: 'Tech',
    })
  })

  it('uses sort order zero when prepending into an empty root list', async () => {
    const watchlistRow = createWatchlistRow()
    const updatedRow = {
      ...watchlistRow,
      updatedAt: new Date('2026-03-17T11:00:00.000Z'),
    }
    const insertedListing = createItemRow({
      id: 'item-new',
      listing: {
        listing_id: 'tsla-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 0,
      createdAt: '2026-03-17T10:30:00.000Z',
    })
    const insertValues = vi.fn().mockResolvedValue(undefined)

    setupTransaction({
      updatedRow,
      insertValues,
      selectResults: [
        [watchlistRow],
        [],
        [],
        [],
        [],
        [insertedListing],
      ],
    })

    const result = await addListingToWatchlist(scope, 'watchlist-1', {
      listing_id: 'tsla-id',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })

    expect(insertValues).toHaveBeenCalledWith({
      watchlistId: 'watchlist-1',
      containerId: null,
      listing: {
        listing_id: 'tsla-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 0,
    })
    expect(result.items).toEqual([
      {
        id: 'item-new',
        type: 'listing',
        listing: {
          listing_id: 'tsla-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
    ])
  })

  it('imports hierarchical file items into root and section containers', async () => {
    const watchlistRow = createWatchlistRow()
    const updatedRow = {
      ...watchlistRow,
      updatedAt: new Date('2026-03-17T11:00:00.000Z'),
    }
    const existingSection = createSectionRow('section-1', 'Macro', 0)
    const createdSection = createSectionRow('section-2', 'Tech', 1)
    const existingApple = createItemRow({
      id: 'item-a',
      listing: {
        listing_id: 'aapl-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 0,
      createdAt: '2026-03-17T10:15:00.000Z',
    })
    const insertedTesla = createItemRow({
      id: 'item-tsla',
      listing: {
        listing_id: 'tsla-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 1,
      createdAt: '2026-03-17T10:25:00.000Z',
    })
    const insertedBitcoin = createItemRow({
      id: 'item-btc',
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USDT',
        listing_type: 'crypto',
      },
      containerId: 'section-2',
      sortOrder: 1,
      createdAt: '2026-03-17T10:30:00.000Z',
    })

    const pendingSelects = [
      [watchlistRow],
      [existingSection],
      [existingApple],
      [{ sortOrder: 0 }],
      [{ sortOrder: 0 }],
      [existingSection, createdSection],
      [existingApple, insertedTesla, insertedBitcoin],
    ]
    const insertValues = vi.fn((value: Record<string, unknown>) => {
      if ('parentId' in value) {
        return {
          returning: vi.fn().mockResolvedValue([createdSection]),
        }
      }

      return Promise.resolve(undefined)
    })
    const tx: any = {
      select: vi.fn(() => {
        if (pendingSelects.length === 0) {
          throw new Error('Unexpected select call')
        }
        return createQueryChain(pendingSelects.shift())
      }),
      insert: vi.fn(() => ({
        values: insertValues,
      })),
      update: vi.fn(() => {
        const chain: any = {}
        chain.set = vi.fn().mockReturnValue(chain)
        chain.where = vi.fn().mockReturnValue(chain)
        chain.returning = vi.fn().mockResolvedValue([updatedRow])
        return chain
      }),
    }

    mockTransaction.mockImplementation(async (callback: (innerTx: unknown) => unknown) => callback(tx))

    const result = await appendWatchlistItemsToWatchlist(scope, 'watchlist-1', [
      {
        type: 'listing',
        listing: {
          listing_id: 'tsla-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        type: 'section',
        label: 'Tech',
        items: [
          {
            type: 'listing',
            listing: {
              listing_id: 'aapl-id',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
          {
            type: 'listing',
            listing: {
              listing_id: '',
              base_id: 'BTC',
              quote_id: 'USDT',
              listing_type: 'crypto',
            },
          },
        ],
      },
    ])

    expect(result.addedCount).toBe(2)
    expect(result.skippedCount).toBe(1)
    expect(insertValues).toHaveBeenNthCalledWith(1, {
      watchlistId: 'watchlist-1',
      containerId: null,
      listing: {
        listing_id: 'tsla-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      sortOrder: 1,
    })
    expect(insertValues).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      parentId: 'watchlist-1',
      name: 'Tech',
      sortOrder: 1,
      isSystem: false,
      settings: {},
      updatedAt: expect.any(Date),
    })
    expect(insertValues).toHaveBeenNthCalledWith(3, {
      watchlistId: 'watchlist-1',
      containerId: 'section-2',
      listing: {
        listing_id: '',
        base_id: 'BTC',
        quote_id: 'USDT',
        listing_type: 'crypto',
      },
      sortOrder: 1,
    })
    expect(result.watchlist.items).toEqual([
      {
        id: 'item-a',
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'item-tsla',
        type: 'listing',
        listing: {
          listing_id: 'tsla-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'section-1',
        type: 'section',
        label: 'Macro',
      },
      {
        id: 'section-2',
        type: 'section',
        label: 'Tech',
      },
      {
        id: 'item-btc',
        type: 'listing',
        listing: {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USDT',
          listing_type: 'crypto',
        },
      },
    ])
  })
})
