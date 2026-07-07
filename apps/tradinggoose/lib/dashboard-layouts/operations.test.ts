import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDashboardLayout,
  deleteDashboardLayout,
  materializeDashboardLayoutFields,
  provisionDashboardLayoutForWorkspaceUserInTx,
  readActiveDashboardLayoutProjection,
} from '@/lib/dashboard-layouts/operations'

const m = vi.hoisted(() => {
  const selectRows = vi.fn()
  const insertRows = vi.fn()
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => selectRows()),
        limit: vi.fn(() => selectRows()),
      })),
    })),
  }))
  const txExecute = vi.fn(() => Promise.resolve())
  const txUpdate = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
  }))
  const txInsert = vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn(() => insertRows()) })),
  }))
  const txDelete = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
  return {
    selectRows,
    insertRows,
    txDelete,
    txExecute,
    txInsert,
    txUpdate,
    validateLayoutRefs: vi.fn(),
    db: {
      select,
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          delete: txDelete,
          execute: txExecute,
          insert: txInsert,
          select,
          update: txUpdate,
        })
      ),
    },
    bridge: {
      applyEntityStateInSocketServer: vi.fn(() => Promise.resolve({})),
      deleteYjsSessionInSocketServer: vi.fn(() => Promise.resolve()),
      refreshEntityListSession: vi.fn(() => Promise.resolve()),
    },
  }
})

vi.mock('@tradinggoose/db', () => ({ db: m.db }))

vi.mock('@tradinggoose/db/schema', () => ({
  workflow: {},
  skill: {},
  customTools: {},
  pineIndicators: {},
  mcpServers: {},
  layoutMap: {
    id: 'id',
    workspaceId: 'workspaceId',
    userId: 'userId',
    name: 'name',
    sort_order: 'sort_order',
    layout: 'layout',
    color_pair: 'color_pair',
    isActive: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn((field) => field),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/copilot/entity-documents', () => ({
  normalizeEntityFields: (_kind: string, fields: unknown) => fields,
}))

vi.mock('@/lib/copilot/tools/server/widgets/widget-reference-validation', () => ({
  validateDashboardLayoutWidgetReferences: m.validateLayoutRefs,
}))

vi.mock('@/lib/dashboard-layouts/read-projection', () => ({
  buildDashboardLayoutReadProjection: vi.fn(async (fields) => ({
    hydratedLayout: fields.layout,
    hydratedColorPairs: fields.colorPairs,
  })),
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => m.bridge)

const scope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'layout-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  name: 'Layout 1',
  sort_order: 0,
  layout: {
    id: 'panel-1',
    type: 'panel',
    widget: null,
  },
  color_pair: { pairs: [] },
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

describe('dashboard layout operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.selectRows.mockReset()
    m.insertRows.mockReset()
  })

  it('creates appended inactive layouts by default', async () => {
    m.selectRows.mockResolvedValueOnce([
      row({ id: 'layout-a', sort_order: 0 }),
      row({ id: 'layout-b', sort_order: 2 }),
    ])
    m.insertRows.mockResolvedValueOnce([
      row({ id: 'layout-new', name: 'Layout 3', sort_order: 3, isActive: false }),
    ])

    const result = await createDashboardLayout(scope)

    expect(result).toMatchObject({
      id: 'layout-new',
      name: 'Layout 3',
      sortOrder: 3,
      isActive: false,
    })
    expect(m.txExecute).toHaveBeenCalled()
    expect(m.txInsert).toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
  })

  it('provisions a default active layout inside an owner transaction', async () => {
    m.selectRows.mockResolvedValueOnce([])
    m.insertRows.mockResolvedValueOnce([
      row({ id: 'layout-new', name: 'Default Layout', sort_order: 0, isActive: true }),
    ])

    const created = await provisionDashboardLayoutForWorkspaceUserInTx(
      {
        delete: m.txDelete,
        execute: m.txExecute,
        insert: m.txInsert,
        select: m.db.select,
        update: m.txUpdate,
      } as any,
      scope
    )

    expect(created).toBe(true)
    expect(m.txExecute).toHaveBeenCalled()
    expect(m.txInsert).toHaveBeenCalled()
  })

  it.each([
    {
      label: 'falls back to the first owned layout when no row is active',
      secondActive: false,
      expected: { id: 'layout-a', isActive: false, sortOrder: 0 },
    },
    {
      label: 'reads the active row',
      secondActive: true,
      expected: { id: 'layout-b', name: 'Second', isActive: true, sortOrder: 1 },
    },
  ])('$label without performing any persisted activation', async ({ secondActive, expected }) => {
    m.selectRows.mockResolvedValueOnce([
      row({ id: 'layout-a', isActive: false }),
      row({ id: 'layout-b', name: 'Second', sort_order: 1, isActive: secondActive }),
    ])

    const result = await readActiveDashboardLayoutProjection(scope)

    expect(result.activeLayout).toMatchObject(expected)
    expect(result.layouts).toEqual([
      expect.objectContaining({ id: 'layout-a', isActive: false }),
      expect.objectContaining({ id: 'layout-b', isActive: secondActive }),
    ])
    expect(m.db.transaction).not.toHaveBeenCalled()
  })

  it('rejects active layout deletion before database and socket side effects', async () => {
    m.selectRows.mockResolvedValueOnce([row({ id: 'layout-active', isActive: true })])

    await expect(deleteDashboardLayout(scope, 'layout-active')).rejects.toThrow(
      'Cannot delete active layout'
    )

    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).not.toHaveBeenCalled()
    expect(m.bridge.deleteYjsSessionInSocketServer).not.toHaveBeenCalled()
  })

  it('deletes inactive layouts and refreshes owner-scoped live sessions', async () => {
    m.selectRows
      .mockResolvedValueOnce([row({ id: 'layout-inactive', isActive: false })])
      .mockResolvedValueOnce([
        row({ id: 'layout-inactive', isActive: false }),
        row({ id: 'layout-other', isActive: true }),
      ])

    await deleteDashboardLayout(scope, 'layout-inactive')

    expect(m.txDelete).toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
    expect(m.bridge.deleteYjsSessionInSocketServer).toHaveBeenCalledWith('layout-inactive')
  })

  it('rejects deleting the last inactive layout', async () => {
    m.selectRows
      .mockResolvedValueOnce([row({ id: 'layout-inactive', isActive: false })])
      .mockResolvedValueOnce([row({ id: 'layout-inactive', isActive: false })])

    await expect(deleteDashboardLayout(scope, 'layout-inactive')).rejects.toThrow(
      'Cannot delete the last dashboard layout in this workspace'
    )

    expect(m.txDelete).not.toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).not.toHaveBeenCalled()
    expect(m.bridge.deleteYjsSessionInSocketServer).not.toHaveBeenCalled()
  })

  it('validates references before mutation and projects sibling metadata into live sessions', async () => {
    m.selectRows
      .mockResolvedValueOnce([row({ id: 'layout-b', isActive: false, sort_order: 1 })])
      .mockResolvedValueOnce([
        row({ id: 'layout-a', isActive: true, sort_order: 0 }),
        row({ id: 'layout-b', isActive: false, sort_order: 1 }),
      ])
      .mockResolvedValueOnce([row({ id: 'layout-b', isActive: true, sort_order: 0 })])

    await materializeDashboardLayoutFields(scope, 'layout-b', {
      isActive: true,
      sortOrder: 0,
    })

    expect(m.validateLayoutRefs).toHaveBeenCalled()
    expect(m.validateLayoutRefs.mock.invocationCallOrder[0]).toBeLessThan(
      m.txUpdate.mock.invocationCallOrder[0]
    )
    expect(m.bridge.applyEntityStateInSocketServer).toHaveBeenCalledWith(
      'layout-a',
      'dashboard_layout',
      expect.objectContaining({ isActive: false, sortOrder: 1 }),
      'user-1'
    )
    expect(m.bridge.applyEntityStateInSocketServer).toHaveBeenCalledWith(
      'layout-b',
      'dashboard_layout',
      expect.objectContaining({ isActive: true, sortOrder: 0 }),
      'user-1'
    )
    expect(m.bridge.deleteYjsSessionInSocketServer).not.toHaveBeenCalledWith('layout-a')
    expect(m.bridge.deleteYjsSessionInSocketServer).not.toHaveBeenCalledWith('layout-b')
  })

  it('rejects unsupported persisted params for known widget contracts before database updates', async () => {
    m.selectRows.mockResolvedValueOnce([row()])

    await expect(
      materializeDashboardLayoutFields(scope, 'layout-1', {
        layout: {
          id: 'panel-1',
          type: 'panel',
          widget: {
            key: 'editor_workflow',
            pairColor: 'gray',
            params: { workflowId: 'workflow-1', listing: { listing_id: 'AAPL' } },
          },
        },
      } as any)
    ).rejects.toThrow('params.listing: Widget "editor_workflow" does not support this field')

    expect(m.db.transaction).not.toHaveBeenCalled()
  })
})
