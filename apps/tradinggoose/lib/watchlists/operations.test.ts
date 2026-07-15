import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbTransaction = vi.hoisted(() => vi.fn())
const mockRefreshEntityList = vi.hoisted(() => vi.fn())

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mockDbTransaction },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  customTools: {},
  knowledgeBase: {},
  layoutMaps: {},
  mcpServers: {},
  pineIndicators: {},
  skill: {},
  workflow: {},
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
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  }),
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  refreshEntityListSession: mockRefreshEntityList,
}))

import {
  composeWatchlistDocumentFromRows,
  listRootWatchlistRowsInTx,
  materializeWatchlistDocumentInTx,
} from '@/lib/watchlists/document'
import { createWatchlistFromDocument } from '@/lib/watchlists/operations'
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

const sectionId = '00000000-0000-4000-8000-000000000001'
const rootListingId = '00000000-0000-4000-8000-000000000002'
const nestedListingId = '00000000-0000-4000-8000-000000000003'
const SPY = {
  listing_id: 'SPY',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}
const NVDA = { ...SPY, listing_id: 'NVDA' }

function queryChain(result: unknown[]) {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

function materializerTx(input: {
  roots?: unknown[]
  containers?: unknown[]
  items?: unknown[]
  updateResults: unknown[][]
}) {
  const selectResults = [input.roots ?? [rootRow], input.containers ?? [], input.items ?? []]
  const inserts: Array<{ table: any; values: Record<string, unknown> }> = []
  const updateResults = [...input.updateResults]
  const tx: any = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => queryChain(selectResults.shift() ?? [])),
    update: vi.fn((table: any) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            const result = updateResults.shift() ?? []
            if (result instanceof Error) throw result
            return result
          }),
        })),
      })),
    })),
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          inserts.push({ table, values })
          return [{ ...values }]
        }),
      })),
    })),
    delete: vi.fn((table: any) => ({
      where: vi.fn(async () => table),
    })),
  }
  return { tx, inserts }
}

const content = {
  settings: { showLogo: true, showTicker: true, showDescription: false },
  items: [
    { id: rootListingId, type: 'listing' as const, parentId: null, listing: SPY },
    { id: sectionId, type: 'section' as const, parentId: null, label: 'Semiconductors' },
    { id: nestedListingId, type: 'listing' as const, parentId: sectionId, listing: NVDA },
  ],
}
const updatedRoot = { ...rootRow, settings: content.settings }
const sectionRow = {
  ...rootRow,
  id: sectionId,
  parentId: rootRow.id,
  name: 'Semiconductors',
  settings: { kind: 'section' },
}
const rootItem = {
  id: rootListingId,
  workspaceId: rootRow.workspaceId,
  userId: null,
  watchlistId: rootRow.id,
  containerId: rootRow.id,
  listing: SPY,
  sortOrder: 0,
  createdAt: rootRow.createdAt,
  updatedAt: rootRow.updatedAt,
}
const nestedItem = { ...rootItem, id: nestedListingId, containerId: sectionId, listing: NVDA }

describe('watchlist operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshEntityList.mockResolvedValue(undefined)
  })

  it('persists new canonical UUIDs unchanged and updates the same rows on the next save', async () => {
    const first = materializerTx({ updateResults: [[updatedRoot], [], [], []] })
    await expect(
      materializeWatchlistDocumentInTx(first.tx, 'workspace-1', 'watchlist-1', content)
    ).resolves.toEqual(content)

    expect(first.inserts.map(({ values }) => values.id)).toEqual([
      sectionId,
      rootListingId,
      nestedListingId,
    ])

    const second = materializerTx({
      containers: [rootRow, sectionRow],
      items: [rootItem, nestedItem],
      updateResults: [[updatedRoot], [sectionRow], [rootItem], [nestedItem]],
    })

    await expect(
      materializeWatchlistDocumentInTx(second.tx, 'workspace-1', 'watchlist-1', content)
    ).resolves.toEqual(content)
    expect(second.inserts).toEqual([])

    const collision = materializerTx({
      containers: [rootRow, sectionRow],
      items: [rootItem, { ...nestedItem, listing: SPY }],
      updateResults: [[updatedRoot], [sectionRow], []],
    })
    await materializeWatchlistDocumentInTx(collision.tx, 'workspace-1', 'watchlist-1', {
      ...content,
      items: [
        { id: sectionId, type: 'section', parentId: null, label: 'Semiconductors' },
        { id: nestedListingId, type: 'listing', parentId: null, listing: SPY },
      ],
    })
    expect(collision.tx.delete).toHaveBeenCalledTimes(2)
  })

  it('maps only the canonical root-name unique constraint to 409', async () => {
    const driverConflict = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'watchlist_table_workspace_user_name_unique',
    })
    mockDbTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Failed query'), { cause: driverConflict })
    )

    await expect(
      createWatchlistFromDocument(
        { workspaceId: 'workspace-1' },
        { name: 'Growth', settings: rootRow.settings, items: [] }
      )
    ).rejects.toMatchObject({
      status: 409,
      message: 'A watchlist with the name "Growth" already exists',
    })

    const other = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'some_other_constraint',
    })
    const wrappedOther = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('transaction failed'), { cause: other }),
    })
    mockDbTransaction.mockRejectedValueOnce(wrappedOther)
    await expect(
      createWatchlistFromDocument(
        { workspaceId: 'workspace-1' },
        { name: 'Growth', settings: rootRow.settings, items: [] }
      )
    ).rejects.toBe(wrappedOther)
  })

  it('locks the root list before validating a reviewed create', async () => {
    const store = materializerTx({ updateResults: [] })
    const sequence: string[] = []
    const staleReview = new Error('stale review')
    store.tx.execute.mockImplementation(async () => {
      sequence.push('lock')
    })
    mockDbTransaction.mockImplementationOnce((callback) => callback(store.tx))

    await expect(
      createWatchlistFromDocument(
        { workspaceId: 'workspace-1' },
        { name: 'Growth', settings: rootRow.settings, items: [] },
        {
          beforeInsert: async () => {
            sequence.push('review')
            throw staleReview
          },
        }
      )
    ).rejects.toBe(staleReview)

    expect(sequence).toEqual(['lock', 'review'])
  })

  it('discovers watchlist entity identities with one root query', async () => {
    const store = materializerTx({ roots: [rootRow], updateResults: [] })

    await expect(listRootWatchlistRowsInTx(store.tx, 'workspace-1')).resolves.toEqual([rootRow])
    expect(store.tx.select).toHaveBeenCalledTimes(1)
  })

  it('accepts canonical parentId ownership and rejects old containerId ownership', () => {
    expect(normalizeWatchlistDocumentFields({ name: 'Growth', ...content })).toEqual({
      name: 'Growth',
      ...content,
    })

    expect(() =>
      normalizeWatchlistDocumentFields({
        name: 'Growth',
        settings: rootRow.settings,
        items: [{ type: 'listing', containerId: null, listing: NVDA }],
      })
    ).toThrow('Invalid watchlist item')
  })

  it('rejects persisted nested sections and listings outside the watchlist hierarchy', () => {
    expect(() =>
      composeWatchlistDocumentFromRows(
        [{ ...sectionRow, id: crypto.randomUUID(), parentId: sectionRow.id }, sectionRow],
        [],
        rootRow.id
      )
    ).toThrow('Persisted watchlist sections cannot be nested')

    expect(() =>
      composeWatchlistDocumentFromRows(
        [sectionRow],
        [
          {
            id: rootListingId,
            workspaceId: rootRow.workspaceId,
            userId: null,
            watchlistId: rootRow.id,
            containerId: 'other-watchlist',
            listing: NVDA,
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
