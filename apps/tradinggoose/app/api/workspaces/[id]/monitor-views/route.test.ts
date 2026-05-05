/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

const {
  mockCheckWorkspacePermission,
  mockGetSession,
  mockOrderBy,
  mockTxWhere,
  mockTxSet,
  mockTxUpdate,
  mockTxReturning,
  mockTxValues,
  mockTxInsert,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCheckWorkspacePermission: vi.fn(),
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
    name: 'monitorView.name',
    workspaceId: 'monitorView.workspaceId',
    userId: 'monitorView.userId',
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

vi.mock('@/app/api/indicators/utils', () => ({
  checkWorkspacePermission: (...args: unknown[]) => mockCheckWorkspacePermission(...args),
}))

describe('monitor view collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockCheckWorkspacePermission.mockResolvedValue({ ok: true, permission: 'write' })
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        sort_order: 1,
        isActive: false,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
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
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
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

  const getCollectionRoute = async () => {
    const { GET } = await import('./route')
    return GET(new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views'), {
      params: Promise.resolve({ id: 'workspace-1' }),
    })
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

  it.each([
    {
      method: 'GET',
      callRoute: () => getCollectionRoute(),
      requireWrite: undefined,
    },
    {
      method: 'POST',
      callRoute: () =>
        postCollectionRoute({
          name: 'Created View',
          config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        }),
      requireWrite: true,
    },
    {
      method: 'PATCH',
      callRoute: () => patchCollectionRoute({ activeViewId: 'view-2' }),
      requireWrite: true,
    },
  ])(
    'rejects $method without workspace permission before row access',
    async ({ callRoute, requireWrite }) => {
      mockCheckWorkspacePermission.mockResolvedValueOnce({
        ok: false,
        code: 'access_denied',
        response: NextResponse.json({ error: 'Access denied' }, { status: 403 }),
      })

      const response = await callRoute()

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Access denied' })
      expect(mockCheckWorkspacePermission).toHaveBeenCalledWith({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        responseShape: 'errorOnly',
        ...(requireWrite ? { requireWrite } : {}),
      })
      expect(mockOrderBy).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
    }
  )

  it('rejects reordered view ids that omit existing rows', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1'],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Mode is required when reordering views' })
  })

  it('rejects reordered view ids with non-string entries', async () => {
    const response = await patchCollectionRoute({
      viewOrder: ['view-1', 2],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Mode is required when reordering views' })
  })

  it('rejects reordered view ids with duplicates', async () => {
    const response = await patchCollectionRoute({
      mode: 'executions',
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
    expect(await response.json()).toEqual({ error: 'Mode is required when reordering views' })
  })

  it('persists a valid reorder and active view change', async () => {
    const response = await patchCollectionRoute({
      mode: 'executions',
      viewOrder: ['view-2', 'view-1'],
      activeViewId: 'view-2',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTxUpdate).toHaveBeenCalled()
  })

  it('rejects reorder requests whose active view belongs to another mode', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        sort_order: 1,
        isActive: false,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-1',
        name: 'Config',
        sort_order: 2,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await patchCollectionRoute({
      mode: 'executions',
      viewOrder: ['view-2', 'view-1'],
      activeViewId: 'config-view-1',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Active view must belong to the reordered mode',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('activates only the target mode and preserves the other mode active hint', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        sort_order: 1,
        isActive: false,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-1',
        name: 'Config',
        sort_order: 2,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await patchCollectionRoute({
      activeViewId: 'view-2',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockTxSet.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) })
    )
    expect(mockTxWhere.mock.calls[0]?.[0]).toMatchObject({
      conditions: [
        { type: 'inArray', values: ['view-1', 'view-2'] },
        { field: 'monitorView.workspaceId', type: 'eq', value: 'workspace-1' },
        { field: 'monitorView.userId', type: 'eq', value: 'user-1' },
      ],
      type: 'and',
    })
  })

  it('reorders same-mode rows without updating other modes', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'view-2',
        name: 'Executions 2',
        sort_order: 1,
        isActive: false,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-1',
        name: 'Config',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await patchCollectionRoute({
      mode: 'executions',
      viewOrder: ['view-2', 'view-1'],
    })

    expect(response.status).toBe(200)
    const sortOrderUpdateIds = mockTxSet.mock.calls
      .map(([patch], index) => ({ patch, where: mockTxWhere.mock.calls[index]?.[0] }))
      .filter(({ patch }) => Object.hasOwn(patch as object, 'sort_order'))
      .map(({ where }) => where.conditions[0].value)

    expect(sortOrderUpdateIds).toEqual(['view-2', 'view-1'])
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

  it('lists strict rows whose runtime mode matches config mode', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-1',
        name: 'Executions',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      {
        id: 'config-view-1',
        name: 'Config',
        sort_order: 1,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await getCollectionRoute()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(2)
    expect(payload.data.every((row: any) => row.mode === row.config.mode)).toBe(true)
  })

  it('returns 409 when stored monitor view rows are unsupported', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'view-legacy',
        name: 'Legacy',
        sort_order: 0,
        isActive: true,
        config: {},
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await getCollectionRoute()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error:
        'Unsupported monitor view data. Delete or reset stale mode-less monitor_view rows for this workspace before using the mode-aware monitor page.',
    })
  })

  it('creates config-mode saved views independently from execution views', async () => {
    mockTxReturning.mockResolvedValue([
      {
        id: 'config-view-created',
        name: 'Config',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        sort_order: 2,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await postCollectionRoute({
      name: 'Config',
      config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      makeActive: true,
    })

    expect(response.status).toBe(201)
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ mode: 'config' }),
        isActive: true,
      })
    )
    const payload = await response.json()
    expect(payload).toEqual(
      expect.objectContaining({
        id: 'config-view-created',
        mode: 'config',
        config: expect.objectContaining({ mode: 'config' }),
      })
    )
    expect(payload.mode).toBe(payload.config.mode)
  })

  it('rejects creating more than 50 views for one mode', async () => {
    mockOrderBy.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        id: `view-${index}`,
        name: `View ${index}`,
        sort_order: index,
        isActive: index === 0,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      }))
    )

    const response = await postCollectionRoute({
      name: 'Created View',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Cannot create more than 50 views for this mode',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('defaults the first created view for a mode to active when makeActive is omitted', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'config-view-1',
        name: 'Config',
        sort_order: 0,
        isActive: true,
        config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])
    mockTxReturning.mockResolvedValue([
      {
        id: 'view-created',
        name: 'Created View',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        sort_order: 1,
        isActive: true,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await postCollectionRoute({
      name: 'Created View',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    })

    expect(response.status).toBe(201)
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_order: 1,
        isActive: true,
      })
    )
    const payload = await response.json()
    expect(payload.mode).toBe(payload.config.mode)
    expect(payload.isActive).toBe(true)
  })

  it('keeps the first mode view inactive when makeActive is explicitly false', async () => {
    mockOrderBy.mockResolvedValue([])
    mockTxReturning.mockResolvedValue([
      {
        id: 'view-created',
        name: 'Created View',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        sort_order: 0,
        isActive: false,
        config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await postCollectionRoute({
      name: 'Created View',
      config: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
      makeActive: false,
    })

    expect(response.status).toBe(201)
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockTxValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_order: 0,
        isActive: false,
      })
    )
    const payload = await response.json()
    expect(payload).toEqual(
      expect.objectContaining({
        id: 'view-created',
        isActive: false,
      })
    )
    expect(payload.mode).toBe(payload.config.mode)
  })

  it('persists valid execution-workspace config fields on create', async () => {
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
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
          filterQuery: 'workflow:#wf-1',
          quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
          sortBy: [],
          kanban: {
            ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
            localCardOrder: { success: ['log-2', 'log-1'] },
          },
        },
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
    ])

    const response = await postCollectionRoute({
      name: 'Created View',
      config: {
        ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
        filterQuery: 'workflow:#wf-1',
        quickFilters: [{ field: 'provider', operator: 'include', values: ['alpaca'] }],
        sortBy: [],
        kanban: {
          ...DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG.kanban,
          localCardOrder: { success: ['log-2', 'log-1'] },
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
    const payload = await response.json()
    expect(payload).toEqual(
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
    expect(payload.mode).toBe(payload.config.mode)
  })
})
