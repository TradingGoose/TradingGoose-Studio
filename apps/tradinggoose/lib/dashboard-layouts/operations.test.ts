import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  createDashboardLayout,
  deleteDashboardLayout,
  persistDashboardLayoutDirtyChannels,
  provisionDashboardLayoutForWorkspaceUserInTx,
  readActiveDashboardLayoutProjection,
  readPersistedDashboardLayoutContent,
} from '@/lib/dashboard-layouts/operations'
import {
  type DashboardLayoutDirtyBatch,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
import type {
  DashboardLayoutDocumentContent,
  DashboardLayoutTopologyNode,
} from '@/widgets/layout-document'

const m = vi.hoisted(() => {
  type Table = { _name: string; [field: string]: unknown }
  type Selection = {
    scope: 'db' | 'tx'
    table: string
    terminal: 'limit' | 'orderBy'
    predicate: unknown
  }
  type Mutation = {
    kind: 'delete' | 'insert' | 'update'
    table: string
    values?: unknown
    predicate?: unknown
  }

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

  const dbSelectResults: unknown[][] = []
  const txSelectResults: unknown[][] = []
  const selections: Selection[] = []
  const mutations: Mutation[] = []
  const conflictUpdates: Array<{ table: string; config: unknown }> = []

  const makeSelect = (scope: Selection['scope'], results: unknown[][]) =>
    vi.fn(() => ({
      from: vi.fn((table: Table) => ({
        where: vi.fn((predicate: unknown) => ({
          limit: vi.fn(() => {
            selections.push({ scope, table: table._name, terminal: 'limit', predicate })
            return Promise.resolve(results.shift() ?? [])
          }),
          orderBy: vi.fn(() => {
            selections.push({ scope, table: table._name, terminal: 'orderBy', predicate })
            return Promise.resolve(results.shift() ?? [])
          }),
        })),
      })),
    }))

  const dbSelect = makeSelect('db', dbSelectResults)
  const txSelect = makeSelect('tx', txSelectResults)
  const insertReturning = vi.fn((_table: Table, _values: unknown) =>
    Promise.resolve([] as unknown[])
  )
  const updateReturning = vi.fn((_table: Table, _values: unknown, _predicate: unknown) =>
    Promise.resolve([] as unknown[])
  )
  const plainInsert = vi.fn((_table: Table, _values: unknown) => Promise.resolve([] as unknown[]))

  const txInsert = vi.fn((table: Table) => ({
    values: vi.fn((values: unknown) => {
      mutations.push({ kind: 'insert', table: table._name, values })
      return {
        returning: vi.fn(() => insertReturning(table, values)),
        onConflictDoUpdate: vi.fn((config: unknown) => {
          conflictUpdates.push({ table: table._name, config })
          return Promise.resolve([])
        }),
        then: (
          onFulfilled?: ((value: unknown[]) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null
        ) => plainInsert(table, values).then(onFulfilled ?? undefined, onRejected ?? undefined),
      }
    }),
  }))
  const txUpdate = vi.fn((table: Table) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn((predicate: unknown) => {
        mutations.push({ kind: 'update', table: table._name, values, predicate })
        return {
          returning: vi.fn(() => updateReturning(table, values, predicate)),
        }
      }),
    })),
  }))
  const txDelete = vi.fn((table: Table) => ({
    where: vi.fn((predicate: unknown) => {
      mutations.push({ kind: 'delete', table: table._name, predicate })
      return Promise.resolve([])
    }),
  }))
  const txExecute = vi.fn(() => Promise.resolve())
  const tx = {
    delete: txDelete,
    execute: txExecute,
    insert: txInsert,
    select: txSelect,
    update: txUpdate,
  }
  const transaction = vi.fn(
    async (callback: (store: typeof tx) => Promise<unknown>, _options?: Record<string, unknown>) =>
      callback(tx)
  )

  return {
    conflictUpdates,
    dbSelect,
    dbSelectResults,
    insertReturning,
    mutations,
    plainInsert,
    selections,
    tables,
    transaction,
    txDelete,
    txExecute,
    txInsert,
    txSelect,
    txSelectResults,
    txUpdate,
    tx,
    updateReturning,
    db: {
      select: dbSelect,
      transaction,
    },
    bridge: {
      deleteYjsSessionInSocketServer: vi.fn(() => Promise.resolve()),
      refreshEntityListSession: vi.fn(() => Promise.resolve()),
    },
  }
})

vi.mock('@tradinggoose/db', () => ({ db: m.db }))
vi.mock('@tradinggoose/db/schema', () => m.tables)
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ operator: 'and', conditions })),
  asc: vi.fn((field: unknown) => ({ operator: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ operator: 'eq', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => m.bridge)

const scope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }

const eqCondition = (field: string, value: unknown) => ({ operator: 'eq', field, value })
const andCondition = (...conditions: unknown[]) => ({ operator: 'and', conditions })
const ownedCondition = (layoutId?: string) =>
  andCondition(
    ...(layoutId ? [eqCondition('layout_maps.id', layoutId)] : []),
    eqCondition('layout_maps.workspaceId', scope.workspaceId),
    eqCondition('layout_maps.userId', scope.ownerUserId)
  )

const topology = (
  identityId = 'widget-1',
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey'] = null
): DashboardLayoutTopologyNode => ({
  id: 'panel-1',
  type: 'panel',
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

const widgetRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'widget-1',
  layoutId: 'layout-1',
  pairColor: 'gray',
  params: null,
  ...overrides,
})

const pairRow = (overrides: Record<string, unknown> = {}) => ({
  layoutId: 'layout-1',
  color: 'blue',
  context: { workflowId: 'workflow-1' },
  ...overrides,
})

const channelContent = (): DashboardLayoutDocumentContent => ({
  layout: topology('widget-1', 'copilot'),
  widgets: {
    'widget-1': { pairColor: 'gray', params: null },
  },
  colorPairs: {
    pairs: [{ color: 'blue', workflowId: 'workflow-1' }],
  },
})

const seededDoc = (content: DashboardLayoutDocumentContent): Y.Doc => {
  const doc = new Y.Doc()
  seedDashboardLayoutSession(doc, content)
  return doc
}

const dirtyBatch = (input: {
  layout?: boolean
  widgetIdentityIds?: string[]
  pairColors?: string[]
}): DashboardLayoutDirtyBatch => ({
  generation: 1,
  layout: input.layout ?? false,
  widgetIdentityIds: new Set(input.widgetIdentityIds ?? []),
  pairColors: new Set(input.pairColors ?? []),
})

const panels = (
  node: DashboardLayoutTopologyNode
): Array<Extract<DashboardLayoutTopologyNode, { type: 'panel' }>> =>
  node.type === 'panel' ? [node] : node.children.flatMap(panels)

describe('dashboard layout operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.dbSelectResults.length = 0
    m.txSelectResults.length = 0
    m.selections.length = 0
    m.mutations.length = 0
    m.conflictUpdates.length = 0
    m.insertReturning.mockReset().mockResolvedValue([])
    m.plainInsert.mockReset().mockResolvedValue([])
    m.updateReturning.mockReset().mockResolvedValue([])
  })

  it('assembles root, widget, and ordered pair rows in one read-only repeatable-read snapshot', async () => {
    m.txSelectResults.push(
      [layoutRow()],
      [widgetRow()],
      [
        pairRow({ color: 'red', context: { skillId: 'skill-1' } }),
        pairRow({ color: 'blue', context: { workflowId: 'workflow-1' } }),
      ]
    )
    m.dbSelectResults.push(
      [layoutRow({ layout: topology('replacement-widget', 'copilot') })],
      [widgetRow({ id: 'replacement-widget' })]
    )

    await expect(readPersistedDashboardLayoutContent(scope, 'layout-1')).resolves.toEqual({
      layout: topology(),
      widgets: {
        'widget-1': { pairColor: 'gray', params: null },
      },
      colorPairs: {
        pairs: [
          { color: 'blue', workflowId: 'workflow-1' },
          { color: 'red', skillId: 'skill-1' },
        ],
      },
    })

    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(m.selections).toEqual([
      {
        scope: 'tx',
        table: 'layout_maps',
        terminal: 'limit',
        predicate: ownedCondition('layout-1'),
      },
      {
        scope: 'tx',
        table: 'layout_widgets',
        terminal: 'orderBy',
        predicate: eqCondition('layout_widgets.layoutId', 'layout-1'),
      },
      {
        scope: 'tx',
        table: 'layout_pairs',
        terminal: 'orderBy',
        predicate: eqCondition('layout_pairs.layoutId', 'layout-1'),
      },
    ])
    expect(m.dbSelect).not.toHaveBeenCalled()
  })

  it.each([
    ['empty context', 'blue', {}, /context is not canonical/i],
    ['null-only context', 'blue', { workflowId: null }, /context is not canonical/i],
    [
      'unsupported-only context',
      'blue',
      { unsupported: 'value' },
      /unsupported field unsupported/i,
    ],
    [
      'embedded color',
      'blue',
      { color: 'blue', workflowId: 'workflow-1' },
      /unsupported field color/i,
    ],
    ['gray color', 'gray', { workflowId: 'workflow-1' }, /has an invalid color/i],
    [
      'noncanonical normalized value',
      'blue',
      { workflowId: ' workflow-1 ' },
      /context is not canonical/i,
    ],
    ['non-object context', 'blue', null, /context must be an object/i],
  ])('rejects a persisted pair row with %s', async (_label, color, context, message) => {
    m.txSelectResults.push([layoutRow()], [widgetRow()], [pairRow({ color, context })])

    await expect(readPersistedDashboardLayoutContent(scope, 'layout-1')).rejects.toMatchObject({
      name: 'DashboardLayoutOperationError',
      status: 500,
      message: expect.stringMatching(message),
    })
  })

  it.each([
    ['missing child', [], /references missing widget widget-1/i],
    [
      'orphan child',
      [widgetRow(), widgetRow({ id: 'orphan-widget' })],
      /contains orphan widget orphan-widget/i,
    ],
    [
      'noncanonical null-widget child',
      [widgetRow({ pairColor: 'red' })],
      /null-key dashboard widget must equal/i,
    ],
  ])('rejects a persisted aggregate with a %s row', async (_label, widgetRows, message) => {
    m.txSelectResults.push([layoutRow()], widgetRows, [])

    await expect(readPersistedDashboardLayoutContent(scope, 'layout-1')).rejects.toMatchObject({
      name: 'DashboardLayoutOperationError',
      status: 500,
      message: expect.stringMatching(message),
    })
  })

  it('projects topology directly from the root table without loading child rows', async () => {
    m.dbSelectResults.push([layoutRow({ name: 'Direct Topology', sortOrder: 2 })])

    await expect(readActiveDashboardLayoutProjection(scope)).resolves.toEqual({
      activeLayout: expect.objectContaining({
        id: 'layout-1',
        name: 'Direct Topology',
        sortOrder: 2,
        topology: topology(),
      }),
      layouts: [expect.objectContaining({ id: 'layout-1', name: 'Direct Topology', sortOrder: 2 })],
    })
    expect(m.selections).toEqual([
      {
        scope: 'db',
        table: 'layout_maps',
        terminal: 'orderBy',
        predicate: ownedCondition(),
      },
    ])
  })

  it('does not treat an inactive row as the active layout', async () => {
    m.dbSelectResults.push([layoutRow({ isActive: false })])

    await expect(readActiveDashboardLayoutProjection(scope)).resolves.toEqual({
      activeLayout: null,
      layouts: [expect.objectContaining({ id: 'layout-1', isActive: false })],
    })
  })

  it.each([
    [
      'duplicate node ids',
      {
        id: 'root',
        type: 'group',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { id: 'panel', type: 'panel', identityId: 'widget-a', widgetKey: null },
          { id: 'panel', type: 'panel', identityId: 'widget-b', widgetKey: null },
        ],
      },
      /duplicate node panel/i,
    ],
    [
      'repeated null-key identities',
      {
        id: 'root',
        type: 'group',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { id: 'panel-a', type: 'panel', identityId: 'widget-a', widgetKey: null },
          { id: 'panel-b', type: 'panel', identityId: 'widget-a', widgetKey: null },
        ],
      },
      /widget widget-a is referenced by multiple panels/i,
    ],
  ])('rejects root-only projection topology with %s', async (_label, layout, message) => {
    m.dbSelectResults.push([layoutRow({ layout })])

    await expect(readActiveDashboardLayoutProjection(scope)).rejects.toMatchObject({
      name: 'DashboardLayoutOperationError',
      status: 500,
      message: expect.stringMatching(message),
    })
  })

  it('creates a topology root and every canonical default child in the same transaction', async () => {
    m.txSelectResults.push([])
    m.insertReturning.mockImplementationOnce((_table, values) =>
      Promise.resolve([
        {
          ...(values as Record<string, unknown>),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
    )

    const created = await createDashboardLayout(scope)
    const rootInsert = m.mutations.find(
      (mutation) => mutation.kind === 'insert' && mutation.table === 'layout_maps'
    )
    const widgetInsert = m.mutations.find(
      (mutation) => mutation.kind === 'insert' && mutation.table === 'layout_widgets'
    )
    const rootValues = rootInsert?.values as {
      id: string
      layout: DashboardLayoutTopologyNode
    }
    const widgetValues = widgetInsert?.values as Array<{
      id: string
      layoutId: string
      pairColor: string
      params: unknown
    }>
    const defaultPanels = panels(rootValues.layout)

    expect(created).toMatchObject({
      id: rootValues.id,
      name: 'Layout 1',
      sortOrder: 0,
      isActive: true,
      topology: rootValues.layout,
    })
    expect(defaultPanels.length).toBeGreaterThan(0)
    expect(new Set(defaultPanels.map((panel) => panel.identityId)).size).toBe(defaultPanels.length)
    expect(widgetValues).toHaveLength(defaultPanels.length)
    for (const panel of defaultPanels) {
      expect(panel.widgetKey).toBeNull()
      expect(widgetValues).toContainEqual({
        id: panel.identityId,
        layoutId: rootValues.id,
        pairColor: 'gray',
        params: null,
      })
    }
    expect(m.mutations.some((mutation) => mutation.table === 'layout_pairs')).toBe(false)
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      scope.workspaceId,
      scope.ownerUserId
    )
  })

  it('creates later layouts inactive without replacing the active layout', async () => {
    m.txSelectResults.push([layoutRow({ id: 'layout-existing' })])
    m.insertReturning.mockImplementationOnce((_table, values) =>
      Promise.resolve([
        {
          ...(values as Record<string, unknown>),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
    )

    const created = await createDashboardLayout(scope)
    const rootMutations = m.mutations.filter((mutation) => mutation.table === 'layout_maps')

    expect(created).toMatchObject({ name: 'Layout 2', sortOrder: 1, isActive: false })
    expect(rootMutations.map((mutation) => mutation.kind)).toEqual(['insert'])
    expect(rootMutations[0]?.values).toEqual(
      expect.objectContaining({ name: 'Layout 2', sortOrder: 1, isActive: false })
    )
  })

  it('keeps provisioning idempotent when the owner already has a root', async () => {
    m.txSelectResults.push([layoutRow()])

    await expect(
      provisionDashboardLayoutForWorkspaceUserInTx(
        m.tx as unknown as Parameters<typeof provisionDashboardLayoutForWorkspaceUserInTx>[0],
        scope
      )
    ).resolves.toBe(false)

    expect(m.txExecute).toHaveBeenCalledTimes(1)
    expect(m.selections).toEqual([
      {
        scope: 'tx',
        table: 'layout_maps',
        terminal: 'orderBy',
        predicate: ownedCondition(),
      },
    ])
    expect(m.mutations).toEqual([])
  })

  it('writes only layout_maps for a topology-only dirty batch', async () => {
    const content = channelContent()
    m.txSelectResults.push([layoutRow({ layout: content.layout })])
    m.updateReturning.mockResolvedValueOnce([{ id: 'layout-1' }])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({ layout: true })
    )

    expect(m.mutations.map(({ kind, table }) => ({ kind, table }))).toEqual([
      { kind: 'update', table: 'layout_maps' },
    ])
    expect(m.mutations[0]?.values).toEqual({
      layout: content.layout,
      updatedAt: expect.any(Date),
    })
    expect(m.mutations[0]?.predicate).toEqual(ownedCondition('layout-1'))
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
  })

  it('touches the parent before upserting a requested layout_pairs row', async () => {
    const content = channelContent()
    m.updateReturning.mockResolvedValueOnce([{ id: 'layout-1' }])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({ pairColors: ['blue'] })
    )

    expect(m.mutations).toEqual([
      {
        kind: 'update',
        table: 'layout_maps',
        values: { updatedAt: expect.any(Date) },
        predicate: ownedCondition('layout-1'),
      },
      {
        kind: 'insert',
        table: 'layout_pairs',
        values: {
          layoutId: 'layout-1',
          color: 'blue',
          context: { workflowId: 'workflow-1' },
        },
      },
    ])
    expect(m.conflictUpdates).toEqual([
      {
        table: 'layout_pairs',
        config: {
          target: ['layout_pairs.layoutId', 'layout_pairs.color'],
          set: { context: { workflowId: 'workflow-1' } },
        },
      },
    ])
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
  })

  it('touches the parent before deleting a requested absent layout_pairs row', async () => {
    const content = { ...channelContent(), colorPairs: { pairs: [] } }
    m.updateReturning.mockResolvedValueOnce([{ id: 'layout-1' }])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({ pairColors: ['blue'] })
    )

    expect(m.mutations.map(({ kind, table }) => ({ kind, table }))).toEqual([
      { kind: 'update', table: 'layout_maps' },
      { kind: 'delete', table: 'layout_pairs' },
    ])
    expect(m.mutations[1]?.predicate).toEqual(
      andCondition(
        eqCondition('layout_pairs.layoutId', 'layout-1'),
        eqCondition('layout_pairs.color', 'blue')
      )
    )
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
  })

  it('touches the parent before updating a requested layout_widgets row', async () => {
    const content = channelContent()
    m.updateReturning
      .mockResolvedValueOnce([{ id: 'layout-1' }])
      .mockResolvedValueOnce([{ id: 'widget-1' }])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({ widgetIdentityIds: ['widget-1'] })
    )

    expect(m.mutations.map(({ kind, table }) => ({ kind, table }))).toEqual([
      { kind: 'update', table: 'layout_maps' },
      { kind: 'update', table: 'layout_widgets' },
    ])
    expect(m.mutations[1]?.values).toEqual({ pairColor: 'gray', params: null })
    expect(m.mutations[1]?.predicate).toEqual(
      andCondition(
        eqCondition('layout_widgets.id', 'widget-1'),
        eqCondition('layout_widgets.layoutId', 'layout-1')
      )
    )
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
  })

  it('orders selected mixed writers as layout_maps, layout_pairs, then layout_widgets', async () => {
    const content = channelContent()
    m.txSelectResults.push([layoutRow({ layout: content.layout })])
    m.updateReturning
      .mockResolvedValueOnce([{ id: 'layout-1' }])
      .mockResolvedValueOnce([{ id: 'widget-1' }])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({ layout: true, pairColors: ['blue'], widgetIdentityIds: ['widget-1'] })
    )

    expect(m.mutations.map(({ kind, table }) => `${kind}:${table}`)).toEqual([
      'update:layout_maps',
      'insert:layout_pairs',
      'update:layout_widgets',
    ])
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
  })

  it('persists a binding replacement through root and scoped widget rows without touching pairs', async () => {
    const content: DashboardLayoutDocumentContent = {
      layout: topology('widget-new', 'copilot'),
      widgets: {
        'widget-new': { pairColor: 'gray', params: null },
      },
      colorPairs: {
        pairs: [
          { color: 'blue', workflowId: 'workflow-1' },
          { color: 'red', skillId: 'skill-1' },
        ],
      },
    }
    m.txSelectResults.push([layoutRow()])
    m.updateReturning.mockResolvedValueOnce([{ id: 'layout-1' }]).mockResolvedValueOnce([])

    await persistDashboardLayoutDirtyChannels(
      scope,
      'layout-1',
      seededDoc(content),
      dirtyBatch({
        layout: true,
        widgetIdentityIds: ['widget-old', 'widget-new'],
      })
    )

    expect(m.mutations.map(({ kind, table }) => `${kind}:${table}`)).toEqual([
      'update:layout_maps',
      'update:layout_widgets',
      'insert:layout_widgets',
      'delete:layout_widgets',
    ])
    expect(m.mutations.some((mutation) => mutation.table === 'layout_pairs')).toBe(false)
    expect(m.mutations[2]?.values).toEqual({
      id: 'widget-new',
      layoutId: 'layout-1',
      pairColor: 'gray',
      params: null,
    })
    expect(m.mutations[3]?.predicate).toEqual({
      operator: 'and',
      conditions: [
        { operator: 'eq', field: 'layout_widgets.id', value: 'widget-old' },
        { operator: 'eq', field: 'layout_widgets.layoutId', value: 'layout-1' },
      ],
    })
  })

  it('rejects a cross-layout widget id collision without overwriting or deleting that row', async () => {
    const content = channelContent()
    const uniqueViolation = Object.assign(new Error('duplicate widget id'), { code: '23505' })
    m.updateReturning.mockResolvedValueOnce([{ id: 'layout-1' }]).mockResolvedValueOnce([])
    m.plainInsert.mockRejectedValueOnce(uniqueViolation)

    await expect(
      persistDashboardLayoutDirtyChannels(
        scope,
        'layout-1',
        seededDoc(content),
        dirtyBatch({ widgetIdentityIds: ['widget-1'] })
      )
    ).rejects.toBe(uniqueViolation)

    expect(m.mutations.map(({ kind, table }) => `${kind}:${table}`)).toEqual([
      'update:layout_maps',
      'update:layout_widgets',
      'insert:layout_widgets',
    ])
    expect(m.mutations[1]?.predicate).toEqual(
      andCondition(
        eqCondition('layout_widgets.id', 'widget-1'),
        eqCondition('layout_widgets.layoutId', 'layout-1')
      )
    )
    expect(m.mutations[2]?.values).toEqual({
      id: 'widget-1',
      layoutId: 'layout-1',
      pairColor: 'gray',
      params: null,
    })
    expect(m.conflictUpdates).toEqual([])
    expect(m.mutations.some((mutation) => mutation.kind === 'delete')).toBe(false)
  })

  it('deletes only the aggregate root and relies on child cascades', async () => {
    m.txSelectResults.push([layoutRow({ isActive: false })])

    await deleteDashboardLayout(scope, 'layout-1')

    expect(m.mutations.map(({ kind, table }) => ({ kind, table }))).toEqual([
      { kind: 'delete', table: 'layout_maps' },
    ])
    expect(m.mutations[0]?.predicate).toEqual(ownedCondition('layout-1'))
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledTimes(1)
    expect(m.bridge.deleteYjsSessionInSocketServer).toHaveBeenCalledWith('layout-1')
  })

  it('rejects active layout deletion before database, list, or socket side effects', async () => {
    m.txSelectResults.push([layoutRow({ isActive: true })])

    await expect(deleteDashboardLayout(scope, 'layout-1')).rejects.toMatchObject({
      name: 'DashboardLayoutOperationError',
      status: 400,
      message: 'Cannot delete active layout',
    })

    expect(m.mutations).toEqual([])
    expect(m.bridge.refreshEntityListSession).not.toHaveBeenCalled()
    expect(m.bridge.deleteYjsSessionInSocketServer).not.toHaveBeenCalled()
  })
})
