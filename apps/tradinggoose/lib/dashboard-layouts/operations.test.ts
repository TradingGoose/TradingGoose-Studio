import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateDashboardLayout,
  commitDashboardLayoutStructure,
  createDashboardLayout,
  deleteDashboardLayout,
  persistDashboardWidgetAndColorPairDocuments,
  provisionDashboardLayoutForWorkspaceUserInTx,
  readActiveDashboardLayoutProjection,
  readPersistedDashboardWidgetBinding,
  reorderDashboardLayouts,
} from '@/lib/dashboard-layouts/operations'
import { runYjsRevocationTransaction } from '@/lib/yjs/server/revocation-fence'

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
    from: vi.fn((_table: Table) => {
      const where = vi.fn((predicate: unknown) => {
        const result = selectResults.shift() ?? []
        return {
          limit: vi.fn(() => Promise.resolve(result)),
          orderBy: vi.fn(() => Promise.resolve(result)),
          then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        }
      })
      return {
        where,
        leftJoin: vi.fn(() => ({ where })),
      }
    }),
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
      refreshEntityListSession: vi.fn(() => Promise.resolve(true)),
      runYjsDrainFencedTransaction: vi.fn(async (_target, mutate, tx) =>
        tx ? mutate(tx) : transaction(mutate)
      ),
    },
    claimRealtimeMutation: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: m.db }))
vi.mock('@tradinggoose/db/schema', () => m.tables)
vi.mock('@/lib/yjs/server/mutation-idempotency', () => ({
  prepareRealtimeMutationTransaction: m.claimRealtimeMutation,
}))
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

  it('reads active topology without loading child rows', async () => {
    m.selectResults.push([layoutRow()])
    const result = await readActiveDashboardLayoutProjection(scope)
    expect(result.activeLayout?.topology).toEqual(topology())
    expect(m.db.select).toHaveBeenCalledTimes(1)
  })

  it('refreshes the active-layout list after updating it', async () => {
    m.selectResults.push([layoutRow(), layoutRow({ id: 'layout-2', isActive: false })])
    m.bridge.refreshEntityListSession.mockResolvedValueOnce(false)

    await expect(activateDashboardLayout(scope, 'layout-2')).resolves.toBeUndefined()
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      scope.workspaceId,
      scope.ownerUserId
    )
  })

  it('persists only complete layout orders', async () => {
    const rows = [layoutRow(), layoutRow({ id: 'layout-2', sortOrder: 1, isActive: false })]
    m.selectResults.push(rows)
    await reorderDashboardLayouts(scope, ['layout-2', 'layout-1'])
    expect(m.mutations.map(({ values }) => (values as { sortOrder: number }).sortOrder)).toEqual([
      0, 1,
    ])
    expect(JSON.stringify(m.mutations.map(({ predicate }) => predicate))).toMatch(
      /layout-2.*layout-1/
    )
    m.mutations.length = 0
    for (const order of [['layout-1'], ['layout-1', 'layout-1'], ['layout-1', 'layout-3']]) {
      m.selectResults.push(rows)
      await expect(reorderDashboardLayouts(scope, order)).rejects.toMatchObject({ status: 400 })
    }
    expect(m.mutations).toEqual([])
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

    const created = await createDashboardLayout(scope)

    const root = m.mutations.find((mutation) => mutation.table === 'layout_maps')
    const children = m.mutations.find((mutation) => mutation.table === 'layout_widgets')
    expect(root?.kind).toBe('insert')
    expect(root?.values).toMatchObject({ layout: created.content.layout })
    expect(children?.kind).toBe('insert')
    expect((children?.values as Array<{ id: string }>).map(({ id }) => id)).toEqual(
      Object.keys(created.content.widgets)
    )
    expect(created.content.colorPairs).toEqual({ pairs: [] })
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

  it('materializes a replacement from source state persisted during drain', async () => {
    let source = { pairColor: 'red', params: null }
    m.returningResults.push([{ id: 'layout-1' }], [])
    await runYjsRevocationTransaction(
      { sessionIds: ['dashboard-widget:layout-1:widget-1'] },
      async () => {
        source = { ...source, pairColor: 'blue' }
        m.selectResults.push([{ layout: layoutRow(), widget: source }])
      },
      (tx) =>
        commitDashboardLayoutStructure(
          scope,
          'layout-1',
          {
            layout: topology('widget-2', 'watchlist'),
            createdBindings: [
              {
                identityId: 'widget-2',
                widgetKey: 'watchlist',
                source: { identityId: 'widget-1', widgetKey: 'data_chart' },
              },
            ],
            removedIdentityIds: ['widget-1'],
            retainedSourceDocuments: new Map(),
          },
          tx
        )
    )

    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.store.select).toHaveBeenCalledOnce()
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'update', table: 'layout_maps' }),
      expect.objectContaining({ kind: 'insert', table: 'layout_widgets' }),
      expect.objectContaining({ kind: 'delete', table: 'layout_widgets' }),
    ])
    expect(m.mutations[1]?.values).toEqual([
      expect.objectContaining({ pairColor: 'blue', params: null }),
    ])
  })

  it('persists only the widget row through the widget owner', async () => {
    m.selectResults.push([layoutRow()])
    m.returningResults.push([{ id: 'widget-1' }])
    await persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
      widget: {
        identityId: 'widget-1',
        content: { pairColor: 'blue', params: { view: { interval: '1h' } } },
      },
    })
    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.mutations.map(({ table }) => table)).toEqual(['layout_widgets'])
    m.mutations.length = 0
    const invalidWidget = { pairColor: 'blue' as const, params: { watchlistId: 'watchlist-1' } }
    m.selectResults.push([layoutRow()])
    await expect(
      persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
        widget: { identityId: 'widget-1', content: invalidWidget },
      })
    ).rejects.toThrow(/does not support this field/i)
    expect(m.mutations).toEqual([])
    m.selectResults.push([layoutRow()])
    await expect(
      persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
        widget: { identityId: 'orphan-widget', content: invalidWidget },
      })
    ).rejects.toThrow(/widget binding not found/i)
    expect(m.mutations).toEqual([])

    const transactionCalls = m.transaction.mock.calls.length
    m.selectResults.push([
      {
        layout: layoutRow(),
        widget: { id: 'widget-1', layoutId: 'layout-1', ...invalidWidget },
      },
    ])
    await expect(
      readPersistedDashboardWidgetBinding(scope, 'layout-1', 'widget-1')
    ).rejects.toThrow(/does not support this field/i)
    expect(m.transaction).toHaveBeenCalledTimes(transactionCalls)
  })

  it('upserts or deletes only the selected color-pair row', async () => {
    m.selectResults.push([layoutRow()])
    await persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
      colorPair: { color: 'red', content: { watchlistId: 'watchlist-1' } },
    })
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'insert', table: 'layout_pairs' }),
    ])

    m.mutations.length = 0
    m.selectResults.push([layoutRow()])
    await persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
      colorPair: { color: 'red', content: {} },
    })
    expect(m.mutations).toEqual([
      expect.objectContaining({ kind: 'delete', table: 'layout_pairs' }),
    ])
  })

  it('persists widget and color-pair owners in one transaction', async () => {
    m.selectResults.push([layoutRow()])
    m.returningResults.push([{ id: 'widget-1' }])

    await persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {
      widget: {
        identityId: 'widget-1',
        content: { pairColor: 'red', params: { view: { interval: '4h' } } },
      },
      colorPair: { color: 'red', content: { watchlistId: 'watchlist-1' } },
    })

    expect(m.transaction).toHaveBeenCalledOnce()
    expect(m.mutations.map(({ table }) => table)).toEqual(['layout_widgets', 'layout_pairs'])
    m.mutations.length = 0
    const mutation = {
      requestId: 'request-1',
      deadlineAt: Date.now() + 40_000,
      fingerprint: 'fingerprint-1',
    }
    m.selectResults.push([layoutRow()])
    await expect(
      persistDashboardWidgetAndColorPairDocuments(scope, 'layout-1', {}, mutation)
    ).resolves.toEqual({})
    expect(m.claimRealtimeMutation).toHaveBeenCalledWith(m.store, mutation, 30_000)
    expect(m.mutations).toEqual([])
  })

  it('fences the layout root before discovering and fencing child sessions', async () => {
    m.selectResults.push(
      [layoutRow({ isActive: false })],
      [{ id: 'widget-1' }],
      [layoutRow({ isActive: false })]
    )

    await deleteDashboardLayout(scope, 'layout-1')

    expect(m.bridge.runYjsDrainFencedTransaction).toHaveBeenCalledTimes(2)
    expect(m.bridge.runYjsDrainFencedTransaction.mock.calls[0]?.[0].sessionIds).toEqual([
      'layout-1',
    ])
    expect(m.transaction).toHaveBeenCalledOnce()
    const childSessionIds = m.bridge.runYjsDrainFencedTransaction.mock.calls[1]?.[0].sessionIds
    expect(childSessionIds).toContain('dashboard-widget:layout-1:widget-1')
    expect(childSessionIds).toContain('dashboard-color-pair:layout-1:red')
    expect(childSessionIds).toHaveLength(6)
    expect(m.bridge.runYjsDrainFencedTransaction.mock.calls[1]?.[2]).toBe(m.store)
    expect(m.mutations.at(-1)).toMatchObject({ kind: 'delete', table: 'layout_maps' })
  })

  it('rejects active layout deletion before session or database side effects', async () => {
    m.selectResults.push([layoutRow()])
    await expect(deleteDashboardLayout(scope, 'layout-1')).rejects.toMatchObject({ status: 400 })
    expect(m.bridge.runYjsDrainFencedTransaction).not.toHaveBeenCalled()
    expect(m.mutations).toEqual([])
  })
})
