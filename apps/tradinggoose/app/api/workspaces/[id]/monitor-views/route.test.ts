/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockOrderBy,
  mockTxWhere,
  mockTxSet,
  mockTxUpdate,
  mockTxReturning,
  mockTxValues,
  mockTxInsert,
  mockTransaction,
} =
  vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOrderBy: vi.fn(),
  mockTxWhere: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxReturning: vi.fn(),
  mockTxValues: vi.fn(),
  mockTxInsert: vi.fn(),
  mockTransaction: vi.fn(),
}))

const mockWhere = vi.fn(() => ({
  orderBy: mockOrderBy,
}))

const mockFrom = vi.fn(() => ({
  where: mockWhere,
}))

const mockSelect = vi.fn(() => ({
  from: mockFrom,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  monitorView: {
    id: 'monitorView.id',
    workspaceId: 'monitorView.workspaceId',
    userId: 'monitorView.userId',
    sort_order: 'monitorView.sort_order',
    createdAt: 'monitorView.createdAt',
    isActive: 'monitorView.isActive',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  asc: vi.fn((value: unknown) => ({ type: 'asc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

describe('monitor view collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockOrderBy.mockResolvedValue([
      { id: 'view-1', sort_order: 0, createdAt: new Date('2026-04-23T00:00:00.000Z') },
      { id: 'view-2', sort_order: 1, createdAt: new Date('2026-04-23T00:00:00.000Z') },
    ])
    mockTxWhere.mockResolvedValue(undefined)
    mockTxSet.mockImplementation(() => ({
      where: mockTxWhere,
    }))
    mockTxUpdate.mockImplementation(() => ({
      set: mockTxSet,
    }))
    mockTxValues.mockImplementation(() => ({
      returning: mockTxReturning,
    }))
    mockTxInsert.mockImplementation(() => ({
      values: mockTxValues,
    }))
    mockTxReturning.mockResolvedValue([
      {
        id: 'view-created',
        name: 'Created View',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        sort_order: 2,
        isActive: true,
        config: {},
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        insert: mockTxInsert,
        update: mockTxUpdate,
      })
    )
  })

  const patchCollectionRoute = async (body: unknown) => {
    const { PATCH } = await import('./route')
    return PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1' }),
      }
    )
  }

  const postCollectionRoute = async (body: unknown) => {
    const { POST } = await import('./route')
    return POST(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1' }),
      }
    )
  }

  it('rejects reordered view ids that omit existing rows', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1'],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid viewOrder' })
  })

  it('rejects reordered view ids with non-string entries', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1', 2],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid viewOrder' })
  })

  it('rejects reordered view ids with duplicates', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1', 'view-1'],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid viewOrder' })
  })

  it('rejects reordered view ids that reference unknown rows', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1', 'view-3'],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid viewOrder' })
  })

  it('persists a valid reorder and active view change', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-2', 'view-1'],
      activeViewId: 'view-2',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTxUpdate).toHaveBeenCalled()
  })

  it('accepts an activeViewId-only patch', async () => {
    const response = await patchCollectionRoute({
      activeViewId: 'view-2',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTxUpdate).toHaveBeenCalledTimes(2)
  })

  it('normalizes and persists execution-workspace config fields on create', async () => {
    mockOrderBy.mockResolvedValue([])
    mockTxReturning.mockResolvedValue([
      {
        id: 'view-created',
        name: 'Created View',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        sort_order: 0,
        isActive: true,
        config: {
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: { localCardOrder: { success: ['log-2', 'log-1'] } },
        },
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await postCollectionRoute({
      name: 'Created View',
      config: {
        filterQuery: 'workflow:#wf-1',
        quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca', 'alpaca'] }],
        sortBy: [],
        kanban: {
          localCardOrder: { success: ['log-2', 'log-1', 'log-1'] },
        },
      },
      makeActive: true,
    })

    expect(response.status).toBe(201)
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: expect.objectContaining({
            localCardOrder: { success: ['log-2', 'log-1'] },
          }),
        }),
      })
    )
    expect(await response.json()).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: expect.objectContaining({
            localCardOrder: { success: ['log-2', 'log-1'] },
          }),
        }),
      })
    )
  })
})
