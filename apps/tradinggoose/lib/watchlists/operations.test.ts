import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  watchlistItem: {
    id: 'watchlist_item.id',
    workspaceId: 'watchlist_item.workspace_id',
    userId: 'watchlist_item.user_id',
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

import { composeWatchlistDocumentFromRows } from '@/lib/watchlists/document'
import { materializeWatchlistDocumentInTx } from '@/lib/watchlists/operations'
import { normalizeWatchlistDocumentFields } from '@/lib/watchlists/validation'

const rootRow = {
  id: 'watchlist-1',
  workspaceId: 'workspace-1',
  userId: null,
  parentId: null,
  name: 'Growth',
  sortOrder: 0,
  settings: { showLogo: true, showTicker: true, showDescription: true },
  createdAt: new Date('2026-03-17T10:00:00.000Z'),
  updatedAt: new Date('2026-03-17T10:00:00.000Z'),
}

const generatedSectionId = '00000000-0000-4000-8000-000000000001'
const generatedListingIds = [
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

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

  it('materializes document-local ids as generated section and listing ids', async () => {
    const whereCalls: Array<{ condition: unknown }> = []
    const insertedRows: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const updatedRows: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const deletedRows: Array<{ table: unknown; condition: unknown }> = []
    const selectResults = [[rootRow]]
    const tx: any = {
      select: vi.fn(() => createQueryChain(selectResults.shift() ?? [], whereCalls)),
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
            returning: vi.fn(async () => [
              {
                ...rootRow,
                ...updatedRows[updatedRows.length - 1]?.values,
              },
            ]),
          }
        })
        return chain
      }),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedRows.push({ table, values })
          return {
            returning: vi.fn(async () => {
              if (
                table === 'watchlist_table.id' ||
                (table as { id?: unknown }).id === 'watchlist_table.id'
              ) {
                return [{ ...rootRow, ...values, id: generatedSectionId }]
              }
              const itemCount = insertedRows.filter(
                (row) => (row.table as any).id === 'watchlist_item.id'
              ).length
              return [
                {
                  id: generatedListingIds[itemCount - 1],
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
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          id: 'root-listing-local',
          type: 'listing',
          parentId: null,
          listing: {
            listing_id: 'SPY',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
        {
          id: 'section-1',
          type: 'section',
          parentId: null,
          label: 'Semiconductors',
        },
        {
          id: 'section-listing-local',
          type: 'listing',
          parentId: 'section-1',
          listing: {
            listing_id: 'NVDA',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

    expect(
      findCondition(
        deletedRows[0]?.condition,
        (condition) => condition.left === 'watchlist_item.workspace_id'
      )
    ).toMatchObject({ right: 'workspace-1' })
    expect(
      findCondition(
        deletedRows[0]?.condition,
        (condition) => condition.left === 'watchlist_item.watchlist_id'
      )
    ).toMatchObject({ right: 'watchlist-1' })
    expect(
      findCondition(
        deletedRows[0]?.condition,
        (condition) => condition.value === 'watchlist_item.user_id'
      )
    ).toBeTruthy()
    expect(
      findCondition(
        deletedRows[1]?.condition,
        (condition) => condition.left === 'watchlist_table.workspace_id'
      )
    ).toMatchObject({ right: 'workspace-1' })
    expect(
      findCondition(
        deletedRows[1]?.condition,
        (condition) => condition.value === 'watchlist_table.user_id'
      )
    ).toBeTruthy()
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
    expect(insertedRows[0]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_table.id' }),
      values: {
        workspaceId: 'workspace-1',
        userId: null,
        parentId: 'watchlist-1',
        name: 'Semiconductors',
        sortOrder: 1,
      },
    })
    expect(insertedRows[0]?.values).not.toHaveProperty('id')
    expect(insertedRows[1]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_item.id' }),
      values: {
        workspaceId: 'workspace-1',
        userId: null,
        watchlistId: 'watchlist-1',
        containerId: 'watchlist-1',
        sortOrder: 0,
      },
    })
    expect(insertedRows[1]?.values).not.toHaveProperty('id')
    expect(insertedRows[2]).toMatchObject({
      table: expect.objectContaining({ id: 'watchlist_item.id' }),
      values: {
        workspaceId: 'workspace-1',
        userId: null,
        watchlistId: 'watchlist-1',
        containerId: generatedSectionId,
        sortOrder: 0,
      },
    })
    expect(insertedRows[2]?.values).not.toHaveProperty('id')
    expect(updatedRows).toEqual([
      {
        table: expect.objectContaining({ id: 'watchlist_table.id' }),
        values: expect.objectContaining({
          settings: { showLogo: true, showTicker: true, showDescription: false },
        }),
      },
    ])
    expect(fields.items).toEqual([
      {
        id: generatedListingIds[0],
        type: 'listing',
        parentId: null,
        listing: {
          listing_id: 'SPY',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      { id: generatedSectionId, type: 'section', parentId: null, label: 'Semiconductors' },
      {
        id: generatedListingIds[1],
        type: 'listing',
        parentId: generatedSectionId,
        listing: {
          listing_id: 'NVDA',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
    ])
  })

  it('accepts canonical parentId ownership and rejects old containerId ownership', () => {
    expect(
      normalizeWatchlistDocumentFields({
        name: 'Growth',
        settings: { showLogo: true, showTicker: true, showDescription: true },
        items: [
          {
            id: 'section-1',
            type: 'section',
            parentId: null,
            label: 'Semiconductors',
          },
          {
            id: 'listing-1',
            type: 'listing',
            parentId: 'section-1',
            listing: {
              listing_id: 'NVDA',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
          },
        ],
      })
    ).toEqual({
      name: 'Growth',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [
        {
          id: 'section-1',
          type: 'section',
          parentId: null,
          label: 'Semiconductors',
        },
        {
          id: 'listing-1',
          type: 'listing',
          parentId: 'section-1',
          listing: {
            listing_id: 'NVDA',
            base_id: '',
            quote_id: '',
            listing_type: 'default',
          },
        },
      ],
    })

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

  it('rejects persisted nested sections and listings outside the watchlist hierarchy', () => {
    const section = {
      ...rootRow,
      id: 'section-1',
      parentId: rootRow.id,
      name: 'Semiconductors',
      settings: { kind: 'section' },
    }

    expect(() =>
      composeWatchlistDocumentFromRows(
        [{ ...section, id: 'nested-section', parentId: section.id }, section],
        [],
        rootRow.id
      )
    ).toThrow('Persisted watchlist sections cannot be nested')

    expect(() =>
      composeWatchlistDocumentFromRows(
        [section],
        [
          {
            id: 'listing-1',
            workspaceId: rootRow.workspaceId,
            userId: null,
            watchlistId: rootRow.id,
            containerId: 'other-watchlist',
            listing: {
              listing_id: 'NVDA',
              base_id: '',
              quote_id: '',
              listing_type: 'default',
            },
            sortOrder: 0,
            createdAt: rootRow.createdAt,
            updatedAt: rootRow.updatedAt,
          },
        ],
        rootRow.id
      )
    ).toThrow('Persisted watchlist listing has an invalid container')
  })
})
