/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '@/app/workspace/[workspaceId]/monitor/components/view-config'

const {
  mockGetSession,
  mockSelectOrderBy,
  mockSelectLimit,
  mockTxUpdateWhere,
  mockTxInsertReturning,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSelectOrderBy: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockTxUpdateWhere: vi.fn(),
  mockTxInsertReturning: vi.fn(),
}))

const mockSelectWhere = vi.fn(() => ({
  orderBy: mockSelectOrderBy,
  limit: mockSelectLimit,
}))

const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
}))

const mockSelect = vi.fn(() => ({
  from: mockSelectFrom,
}))

const mockTxUpdateSet = vi.fn(() => ({
  where: mockTxUpdateWhere,
}))

const mockTxUpdate = vi.fn(() => ({
  set: mockTxUpdateSet,
}))

const mockTxInsertValues = vi.fn(() => ({
  returning: mockTxInsertReturning,
}))

const mockTxInsert = vi.fn(() => ({
  values: mockTxInsertValues,
}))

const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    update: mockTxUpdate,
    insert: mockTxInsert,
  })
)

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
    name: 'monitorView.name',
    sort_order: 'monitorView.sort_order',
    config: 'monitorView.config',
    isActive: 'monitorView.isActive',
    createdAt: 'monitorView.createdAt',
    updatedAt: 'monitorView.updatedAt',
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

const now = new Date('2026-04-22T00:00:00.000Z')

const createDbRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'view-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Default View',
  sort_order: 0,
  isActive: true,
  config: DEFAULT_MONITOR_VIEW_CONFIG,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

describe('monitor views collection route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockSelectOrderBy.mockReset()
    mockSelectLimit.mockReset()
    mockTxUpdateWhere.mockReset()
    mockTxInsertReturning.mockReset()
  })

  it('lists the current user monitor views for a workspace', async () => {
    mockSelectOrderBy.mockResolvedValue([createDbRow()])

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views'),
      {
        params: Promise.resolve({ id: 'workspace-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'view-1',
          name: 'Default View',
          sortOrder: 0,
          isActive: true,
          config: DEFAULT_MONITOR_VIEW_CONFIG,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    })
  })

  it('creates and activates the default personal view when requested', async () => {
    mockSelectOrderBy.mockResolvedValue([])
    mockTxUpdateWhere.mockResolvedValue(undefined)
    mockTxInsertReturning.mockResolvedValue([createDbRow()])

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Default View',
          config: DEFAULT_MONITOR_VIEW_CONFIG,
          makeActive: true,
        }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1' }),
      }
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      id: 'view-1',
      name: 'Default View',
      sortOrder: 0,
      isActive: true,
      config: DEFAULT_MONITOR_VIEW_CONFIG,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    expect(mockTxInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Default View',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_MONITOR_VIEW_CONFIG,
      })
    )
  })

  it('activates another saved view inside the same workspace', async () => {
    mockSelectLimit.mockResolvedValue([{ id: 'view-2' }])
    mockTxUpdateWhere.mockResolvedValue(undefined)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views', {
        method: 'PATCH',
        body: JSON.stringify({ activeViewId: 'view-2' }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTxUpdateWhere).toHaveBeenCalledTimes(2)
  })
})
