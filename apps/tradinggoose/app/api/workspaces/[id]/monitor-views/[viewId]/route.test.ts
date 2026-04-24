/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

const {
  mockGetSession,
  mockSelectLimit,
  mockSelectOrderBy,
  mockUpdateWhere,
  mockDeleteWhere,
  mockDelete,
  mockTransaction,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockSelectOrderBy: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDelete: vi.fn(),
  mockTransaction: vi.fn(),
}))

const mockSelectWhere = vi.fn(() => ({
  limit: mockSelectLimit,
  orderBy: mockSelectOrderBy,
}))

const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
}))

const mockSelect = vi.fn(() => ({
  from: mockSelectFrom,
}))

const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))

const mockUpdate = vi.fn(() => ({
  set: mockUpdateSet,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
    update: mockUpdate,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  monitorView: {
    id: 'monitorView.id',
    workspaceId: 'monitorView.workspaceId',
    userId: 'monitorView.userId',
    name: 'monitorView.name',
    config: 'monitorView.config',
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

describe('monitor view item route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockSelectLimit.mockResolvedValue([{ id: 'view-1' }])
    mockSelectOrderBy.mockResolvedValue([{ id: 'view-1', isActive: true, sort_order: 0 }])
    mockUpdateWhere.mockResolvedValue(undefined)
    mockDeleteWhere.mockResolvedValue(undefined)
    mockDelete.mockImplementation(() => ({
      where: mockDeleteWhere,
    }))
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        delete: mockDelete,
        update: mockUpdate,
      })
    )
  })

  it('normalizes the saved execution-workspace config on update', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            ...DEFAULT_MONITOR_VIEW_CONFIG,
            filterQuery: 'workflow:#wf-1',
            quickFilters: [
              { field: 'provider', operator: 'include', values: ['alpaca', 'alpaca'] },
            ],
            sortBy: [],
            kanban: {
              ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
              localCardOrder: {
                success: ['log-1', 'log-1', 'log-2'],
              },
              visibleFieldIds: ['workflow', 'workflow', 'cost'],
            },
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          ...DEFAULT_MONITOR_VIEW_CONFIG,
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: {
            ...DEFAULT_MONITOR_VIEW_CONFIG.kanban,
            localCardOrder: {
              success: ['log-1', 'log-2'],
            },
            visibleFieldIds: ['workflow', 'cost'],
          },
        },
        updatedAt: expect.any(Date),
      })
    )
  })

  it('rejects deleting the last remaining view', async () => {
    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot delete the last remaining view' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('reassigns the active view when deleting the current active row', async () => {
    mockSelectOrderBy.mockResolvedValue([
      { id: 'view-1', isActive: true, sort_order: 0 },
      { id: 'view-2', isActive: false, sort_order: 1 },
    ])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockDelete).toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        updatedAt: expect.any(Date),
      })
    )
  })

  it('reassigns the active view to the previous sibling when available', async () => {
    mockSelectOrderBy.mockResolvedValue([
      { id: 'view-1', isActive: false, sort_order: 0 },
      { id: 'view-2', isActive: true, sort_order: 1 },
      { id: 'view-3', isActive: false, sort_order: 2 },
    ])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-2', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-2' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const finalActivationWhere = mockUpdateWhere.mock.calls.at(-1)?.[0]
    expect(finalActivationWhere).toEqual(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: 'monitorView.id', value: 'view-1' }),
        ]),
      })
    )
  })
})
