import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: vi.fn(),
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
    updatedAt: 'watchlist_item.updated_at',
  },
  watchlistTable: {
    id: 'watchlist_table.id',
    workspaceId: 'watchlist_table.workspace_id',
    userId: 'watchlist_table.user_id',
    rootWatchlistId: 'watchlist_table.root_watchlist_id',
    parentId: 'watchlist_table.parent_id',
    name: 'watchlist_table.name',
    sortOrder: 'watchlist_table.sort_order',
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
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
}))

import { normalizeWatchlistDocumentFields } from '@/lib/watchlists/document'
import { materializeWatchlistDocumentInTx } from '@/lib/watchlists/operations'

const rootRow = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: null,
  rootWatchlistId: null,
  parentId: null,
  name: 'Growth',
  sortOrder: 0,
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: new Date('2026-03-17T10:00:00.000Z'),
  updatedAt: new Date('2026-03-17T10:00:00.000Z'),
}

const createQueryChain = (result: unknown, whereCalls: Array<{ condition: unknown }>) => {
  const chain: any = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn((condition: unknown) => {
    whereCalls.push({ condition })
    return chain
  })
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

const findCondition = (
  condition: unknown,
  predicate: (condition: Record<string, unknown>) => boolean
): Record<string, unknown> | null => {
  if (!condition || typeof condition !== 'object') return null
  const record = condition as Record<string, unknown>
  if (predicate(record)) return record
  const children = Array.isArray(record.conditions) ? record.conditions : []
  for (const child of children) {
    const found = findCondition(child, predicate)
    if (found) return found
  }
  return null
}

describe('watchlist operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('materializes sections as root-owned rows and listings as root watchlist items', async () => {
    const whereCalls: Array<{ condition: unknown }> = []
    const insertedRows: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const updatedRows: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const deletedRows: Array<{ table: unknown; condition: unknown }> = []
    const selectResults = [
      [rootRow],
      [
        {
          ...rootRow,
          id: 'section-old',
          rootWatchlistId: 'watchlist-1',
          parentId: null,
          name: 'Old',
        },
      ],
      [
        {
          id: 'item-old',
          watchlistId: 'watchlist-1',
          containerId: 'section-old',
          listing: {
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
          sortOrder: 0,
          createdAt: new Date('2026-03-17T10:15:00.000Z'),
          updatedAt: new Date('2026-03-17T10:15:00.000Z'),
        },
      ],
    ]
    const tx: any = {
      select: vi.fn(() => {
        if (selectResults.length === 0) throw new Error('Unexpected select call')
        return createQueryChain(selectResults.shift(), whereCalls)
      }),
      delete: vi.fn((table: unknown) => ({
        where: vi.fn(async (condition: unknown) => {
          deletedRows.push({ table, condition })
        }),
      })),
      update: vi.fn((table: unknown) => {
        const chain: any = {}
        chain.set = vi.fn((values: Record<string, unknown>) => {
          updatedRows.push({ table, values })
          return chain
        })
        chain.where = vi.fn((condition: unknown) => {
          whereCalls.push({ condition })
          return {
            returning: vi.fn(async () => [{ id: 'updated-row' }]),
          }
        })
        return chain
      }),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedRows.push({ table, values })
          return {
            returning: vi.fn(async () => {
              if ('rootWatchlistId' in values) {
                return [{ ...rootRow, ...values, id: 'section-new' }]
              }
              return [
                {
                  id: 'item-new',
                  watchlistId: values.watchlistId,
                  containerId: values.containerId,
                  listing: values.listing,
                  sortOrder: values.sortOrder,
                  createdAt: new Date('2026-03-17T10:20:00.000Z'),
                  updatedAt: new Date('2026-03-17T10:20:00.000Z'),
                },
              ]
            }),
          }
        }),
      })),
    }

    const fields = await materializeWatchlistDocumentInTx(tx, 'workspace-1', 'watchlist-1', {
      name: 'Growth',
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          type: 'section',
          label: 'Semiconductors',
        },
        {
          type: 'listing',
          listing: {
            listing_id: 'NVDA',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    const rootLookup = whereCalls[0]?.condition
    expect(findCondition(rootLookup, (condition) => condition.left === 'watchlist_table.workspace_id'))
      .toMatchObject({ right: 'workspace-1' })
    expect(findCondition(rootLookup, (condition) => condition.value === 'watchlist_table.user_id'))
      .toBeTruthy()
    expect(
      findCondition(rootLookup, (condition) => condition.value === 'watchlist_table.root_watchlist_id')
    ).toBeTruthy()
    expect(findCondition(rootLookup, (condition) => condition.value === 'watchlist_table.parent_id'))
      .toBeTruthy()

    expect(deletedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: expect.objectContaining({ id: 'watchlist_item.id' }),
        }),
        expect.objectContaining({
          table: expect.objectContaining({ id: 'watchlist_table.id' }),
        }),
      ])
    )
    expect(
      findCondition(deletedRows[1]?.condition, (condition) => condition.left === 'watchlist_table.root_watchlist_id')
    ).toMatchObject({ right: 'watchlist-1' })

    expect(insertedRows[0]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_table.id' }),
      values: {
        userId: null,
        rootWatchlistId: 'watchlist-1',
        parentId: null,
        name: 'Semiconductors',
        sortOrder: 0,
      },
    })
    expect(insertedRows[1]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_item.id' }),
      values: {
        watchlistId: 'watchlist-1',
        containerId: 'section-new',
        sortOrder: 0,
      },
    })
    expect(updatedRows[0]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_table.id' }),
      values: {
        name: 'Growth',
        settings: { showLogo: true, showTicker: true, showDescription: false },
      },
    })
    expect(fields.items).toEqual([
      { id: 'section-new', type: 'section', label: 'Semiconductors' },
      {
        id: 'item-new',
        type: 'listing',
        listing: {
          listing_id: 'NVDA',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
    ])
  })

  it('rejects explicit ownership metadata instead of reinterpreting non-flat item order', () => {
    expect(() =>
      normalizeWatchlistDocumentFields({
        name: 'Growth',
        settings: { showLogo: true, showTicker: true, showDescription: true },
        items: [
          {
            type: 'section',
            label: 'Semiconductors',
          },
          {
            type: 'listing',
            containerId: null,
            listing: {
              listing_id: 'NVDA',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
        ],
      })
    ).toThrow('Invalid watchlist item')
  })
})
