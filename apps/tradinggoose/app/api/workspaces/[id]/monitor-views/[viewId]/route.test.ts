/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

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

const mockUpdateSet = vi.fn((_patch: unknown) => ({
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
    sort_order: 'monitorView.sort_order',
    createdAt: 'monitorView.createdAt',
    updatedAt: 'monitorView.updatedAt',
    isActive: 'monitorView.isActive',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  asc: vi.fn((value: unknown) => ({ type: 'asc', value })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, type: 'inArray', values })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

describe('monitor view item route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockSelectLimit.mockResolvedValue([{ id: 'view-1' }])
    mockSelectOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        isActive: true,
        sort_order: 0,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])
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

  it('persists a valid saved execution-workspace config on update', async () => {
    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
            filterQuery: 'workflow:#wf-1',
            quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
            sortBy: [],
            kanban: {
              ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
              localCardOrder: {
                success: ['log-1', 'log-2'],
              },
              visibleFieldIds: ['workflow', 'cost'],
            },
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.objectContaining({
        id: 'view-1',
        mode: 'executions',
      })
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: {
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
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

  it('persists a valid saved config-workspace config on update', async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: 'config-view-1',
        name: 'Config',
        isActive: true,
        sort_order: 0,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/config-view-1', {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
            filterQuery: 'status:active',
            sortBy: [],
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'config-view-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          mode: 'config',
          filterQuery: 'status:active',
          sortBy: [],
        }),
        updatedAt: expect.any(Date),
      })
    )
  })

  it('returns 409 when stored item rows are unsupported', async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: 'view-legacy',
        name: 'Legacy',
        isActive: true,
        sort_order: 0,
        config: {},
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-legacy', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Still Legacy' }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-legacy' }),
      }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error:
        'Unsupported monitor view data. Delete or reset stale mode-less monitor_view rows for this workspace before using the mode-aware monitor page.',
    })
    expect(mockUpdateSet).not.toHaveBeenCalled()
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
    expect(await response.json()).toEqual({
      error: 'Cannot delete the last remaining view for this mode',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('reassigns the active view when deleting the current active row', async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        isActive: true,
        sort_order: 0,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        isActive: false,
        sort_order: 1,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
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
      {
        id: 'view-1',
        name: 'Executions',
        isActive: false,
        sort_order: 0,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        isActive: true,
        sort_order: 1,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-3',
        name: 'Executions 3',
        isActive: false,
        sort_order: 2,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
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

  it('compacts global sort order after deleting one mode row', async () => {
    mockSelectOrderBy.mockResolvedValue([
      {
        id: 'execution-view-1',
        name: 'Executions',
        isActive: true,
        sort_order: 0,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-1',
        name: 'Config',
        isActive: false,
        sort_order: 0,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-2',
        name: 'Config 2',
        isActive: true,
        sort_order: 1,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/config-view-1', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'config-view-1' }),
      }
    )

    expect(response.status).toBe(200)
    const sortOrderUpdateIds = mockUpdateSet.mock.calls
      .filter(([patch]) => Object.hasOwn(patch as object, 'sort_order'))
      .map((_, index) => mockUpdateWhere.mock.calls[index]?.[0]?.conditions?.[0]?.value)

    expect(sortOrderUpdateIds).toEqual(['execution-view-1', 'config-view-2'])
  })
})
