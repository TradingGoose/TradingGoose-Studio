import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitDashboardLayoutStructure,
  createDashboardLayout,
  deleteDashboardLayout,
  persistDashboardColorPairDocument,
  persistDashboardWidgetDocument,
  provisionDashboardLayoutForWorkspaceUserInTx,
  readActiveDashboardLayoutProjection,
  readPersistedDashboardLayoutProjection,
  readPersistedDashboardWidgetBinding,
} from '@/lib/dashboard-layouts/operations'

const m = vi.hoisted(() => {
  type Table = { _name: string; [field: string]: unknown }
  const tables = {
    layoutMaps: {
      _name: 'layout_maps',
      id: 'layout_maps.id',
      workspaceId: 'layout_maps.workspaceId',
      userId: 'layout_maps.userId',
      name: 'layout_maps.name',
      sortOrder: 'layout_maps.sortOrder',
      layout: 'layout_maps.layout',
      isActive: 'layout_maps.isActive',
      createdAt: 'layout_maps.createdAt',
      updatedAt: 'layout_maps.updatedAt',
    },
    layoutWidgets: {
      _name: 'layout_widgets',
      id: 'layout_widgets.id',
      layoutId: 'layout_widgets.layoutId',
      pairColor: 'layout_widgets.pairColor',
      params: 'layout_widgets.params',
    },
    layoutPairs: {
      _name: 'layout_pairs',
      layoutId: 'layout_pairs.layoutId',
      color: 'layout_pairs.color',
      context: 'layout_pairs.context',
    },
  } satisfies Record<string, Table>
  const selectResults: unknown[][] = []
  const mutations: Array<{ kind: string; table: string; values?: unknown; predicate?: unknown }> =
    []
  const returningResults: unknown[][] = []
  const conflictUpdates: unknown[] = []

  const select = vi.fn(() => ({
    from: vi.fn((table: Table) => ({
      where: vi.fn((predicate: unknown) => {
        const result = selectResults.shift() ?? []
        return {
          limit: vi.fn(() => Promise.resolve(result)),
          orderBy: vi.fn(() => Promise.resolve(result)),
          then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        }
      }),
    })),
  }))
  const insert = vi.fn((table: Table) => ({
    values: vi.fn((values: unknown) => {
      mutations.push({ kind: 'insert', table: table._name, values })
      const result = returningResults.shift() ?? []
      return {
        returning: vi.fn(() => Promise.resolve(result)),
        onConflictDoUpdate: vi.fn((config: unknown) => {
          conflictUpdates.push(config)
          return Promise.resolve([])
        }),
        then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      }
    }),
  }))
  const update = vi.fn((table: Table) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn((predicate: unknown) => {
        mutations.push({ kind: 'update', table: table._name, values, predicate })
        const result = returningResults.shift() ?? []
        const promise = Promise.resolve(result)
        return {
          returning: vi.fn(() => promise),
          then: promise.then.bind(promise),
        }
      }),
    })),
  }))
  const deleteRows = vi.fn((table: Table) => ({
    where: vi.fn((predicate: unknown) => {
      mutations.push({ kind: 'delete', table: table._name, predicate })
      return Promise.resolve([])
    }),
  }))
  const execute = vi.fn(() => Promise.resolve())
  const store = { delete: deleteRows, execute, insert, select, update }
  const transaction = vi.fn(async (callback: (tx: typeof store) => Promise<unknown>) =>
    callback(store)
  )
  return {
    tables,
    selectResults,
    returningResults,
    mutations,
    conflictUpdates,
    store,
    transaction,
    db: { ...store, transaction },
    bridge: {
      refreshEntityListSession: vi.fn(() => Promise.resolve()),
      withYjsSessionDeletionLease: vi.fn(
        async (_sessionIds: string[], mutate: () => Promise<unknown>) => mutate()
      ),
    },
  }
})

vi.mock('@tradinggoose/db', () => ({ db: m.db }))
vi.mock('@tradinggoose/db/schema', () => m.tables)
vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ operator: 'and', conditions }),
  asc: (field: unknown) => ({ operator: 'asc', field }),
  eq: (field: unknown, value: unknown) => ({ operator: 'eq', field, value }),
  inArray: (field: unknown, values: unknown[]) => ({ operator: 'inArray', field, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => m.bridge)

const scope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }
const topology = (
  identityId = 'widget-1',
  widgetKey: 'data_chart' | 'watchlist' | null = 'data_chart'
) => ({
  id: 'panel-1',
  type: 'panel' as const,
  identityId,
  widgetKey,
})
const layoutRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'layout-1',
  workspaceId: scope.workspaceId,
  userId: scope.ownerUserId,
  name: 'Layout 1',
  sortOrder: 0,
  layout: topology(),
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

describe('dashboard layout operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.selectResults.length = 0
    m.returningResults.length = 0
    m.mutations.length = 0
    m.conflictUpdates.length = 0
  })

  it('assembles an effective projection from the three canonical tables', async () => {
    m.selectResults.push(
      [layoutRow()],
      [{ id: 'widget-1', layoutId: 'layout-1', pairColor: 'red', params: { view: {} } }],
      [{ layoutId: 'layout-1', color: 'red', context: { watchlistId: 'watchlist-1' } }]
    )

    await expect(readPersistedDashboardLayoutProjection(scope, 'layout-1')).resolves.toEqual({
      layout: topology(),
      widgets: { 'widget-1': { pairColor: 'red', params: { view: {} } } },
      colorPairs: { pairs: [{ color: 'red', watchlistId: 'watchlist-1' }] },
    })
  })

  it('reads active topology without loading child rows', async () => {
    m.selectResults.push([layoutRow()])
    const result = await readActiveDashboardLayoutProjection(scope)
    expect(result.activeLayout?.topology).toEqual(topology())
    expect(m.db.select).toHaveBeenCalledTimes(1)
  })

  it('creates a default root and every null-widget child in one transaction', async () => {
    const staleReview = () => {
      throw new Error('stale review')
    }
    m.selectResults.push([])
    await expect(createDashboardLayout(scope, { beforeInsert: staleReview })).rejects.toThrow(
      'stale review'
    )
    expect(m.mutations).toEqual([])

    m.selectResults.push([])
    m.returningResults.push([layoutRow()])

    await createDashboardLayout(scope)

    const root = m.mutations.find((mutation) => mutation.table === 'layout_maps')
    const children = m.mutations.find((mutation) => mutation.table === 'layout_widgets')
    expect(root?.kind).toBe('insert')
    expect(children?.kind).toBe('insert')
    expect(Array.isArray(children?.values)).toBe(true)
    expect((children?.values as unknown[]).length).toBeGreaterThan(0)
  })

  it('keeps provisioning idempotent when the owner already has a layout', async () => {
    m.selectResults.push([layoutRow()])
    await expect(
      provisionDashboardLayoutForWorkspaceUserInTx(
        m.store as unknown as Parameters<typeof provisionDashboardLayoutForWorkspaceUserInTx>[0],
        scope
      )
    ).resolves.toBe(false)
    expect(m.mutations).toEqual([])
  })

  it('commits topology and widget row lifecycle in one transaction', async () => {
    m.selectResults.push([layoutRow()])
    m.returningResults.push([], [{ id: 'layout-1' }])
    await commitDashboardLayoutStructure(scope, 'layout-1', {
      layout: topology('widget-2', 'watchlist'),
      createdWidgets: [
        {
          binding: { identityId: 'widget-2', widgetKey: 'watchlist' },
          document: { pairColor: 'gray', params: null },
        },
      ],
      removedIdentityIds: ['widget-1'],
    })

    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'insert', table: 'layout_widgets' }),
      expect.objectContaining({ kind: 'update', table: 'layout_maps' }),
      expect.objectContaining({ kind: 'delete', table: 'layout_widgets' }),
    ])
  })

  it('persists a widget and its selected color-pair in one transaction', async () => {
    m.selectResults.push([layoutRow()])
    m.returningResults.push([{ id: 'widget-1' }])
    await persistDashboardWidgetDocument(
      scope,
      'layout-1',
      'widget-1',
      { pairColor: 'blue', params: { view: { interval: '1h' } } },
      { watchlistId: 'watchlist-1' }
    )
    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.mutations.map(({ table }) => table)).toEqual(['layout_widgets', 'layout_pairs'])
    m.mutations.length = 0
    const invalidWidget = { pairColor: 'blue' as const, params: { watchlistId: 'watchlist-1' } }
    m.selectResults.push([layoutRow()])
    await expect(
      persistDashboardWidgetDocument(scope, 'layout-1', 'widget-1', invalidWidget)
    ).rejects.toThrow(/does not support this field/i)
    expect(m.mutations).toEqual([])
    m.selectResults.push([layoutRow()])
    await expect(
      persistDashboardWidgetDocument(scope, 'layout-1', 'orphan-widget', invalidWidget)
    ).rejects.toThrow(/widget binding not found/i)
    expect(m.mutations).toEqual([])

    m.selectResults.push(
      [layoutRow()],
      [{ id: 'widget-1', layoutId: 'layout-1', ...invalidWidget }]
    )
    await expect(
      readPersistedDashboardWidgetBinding(scope, 'layout-1', 'widget-1')
    ).rejects.toThrow(/does not support this field/i)
  })

  it('upserts or deletes only the selected color-pair row', async () => {
    m.selectResults.push([layoutRow()])
    await persistDashboardColorPairDocument(scope, 'layout-1', 'red', {
      watchlistId: 'watchlist-1',
    })
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'insert', table: 'layout_pairs' }),
    ])

    m.mutations.length = 0
    m.selectResults.push([layoutRow()])
    await persistDashboardColorPairDocument(scope, 'layout-1', 'red', {})
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'delete', table: 'layout_pairs' }),
    ])
  })

  it('leases the layout root before discovering and leasing child sessions', async () => {
    m.selectResults.push(
      [layoutRow({ isActive: false })],
      [{ id: 'widget-1' }],
      [layoutRow({ isActive: false })]
    )

    await deleteDashboardLayout(scope, 'layout-1')

    expect(m.bridge.withYjsSessionDeletionLease.mock.calls[0]?.[0]).toEqual(['layout-1'])
    const childSessionIds = m.bridge.withYjsSessionDeletionLease.mock.calls[1]?.[0]
    expect(childSessionIds).toContain('dashboard-widget:layout-1:widget-1')
    expect(childSessionIds).toContain('dashboard-color-pair:layout-1:red')
    expect(childSessionIds).toHaveLength(6)
    expect(m.mutations.at(-1)).toMatchObject({ kind: 'delete', table: 'layout_maps' })
  })

  it('rejects active layout deletion before session or database side effects', async () => {
    m.selectResults.push([layoutRow()])
    await expect(deleteDashboardLayout(scope, 'layout-1')).rejects.toMatchObject({ status: 400 })
    expect(m.bridge.withYjsSessionDeletionLease).not.toHaveBeenCalled()
    expect(m.mutations).toEqual([])
  })
})
