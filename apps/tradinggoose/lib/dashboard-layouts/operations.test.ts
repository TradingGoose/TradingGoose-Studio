import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDashboardLayout,
  deleteDashboardLayout,
  ensureDashboardLayoutProvisioned,
  materializeDashboardLayoutFields,
} from '@/lib/dashboard-layouts/operations'
import type { LayoutNode, PersistedColorPairsState } from '@/widgets/layout'

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

  it('provisions missing owner layouts idempotently', async () => {
    m.selectRows.mockResolvedValueOnce([])
    m.insertRows.mockResolvedValueOnce([row({ id: 'layout-new', name: 'Default Layout' })])

    await ensureDashboardLayoutProvisioned(scope)

    expect(m.txInsert).toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )

    vi.clearAllMocks()
    m.selectRows.mockResolvedValueOnce([row()])

    await ensureDashboardLayoutProvisioned(scope)

    expect(m.txInsert).not.toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).not.toHaveBeenCalled()
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

  it('projects sibling metadata into live sessions after materializing layout fields', async () => {
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

  it('fans out committed content when materialization also changes metadata', async () => {
    const nextLayout: LayoutNode = {
      id: 'panel-next',
      type: 'panel',
      widget: null,
    }
    const nextColorPairs: PersistedColorPairsState = {
      pairs: [{ color: 'red', workflowId: 'workflow-1' }],
    }
    m.selectRows
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        row({ name: 'Renamed', layout: nextLayout, color_pair: nextColorPairs }),
      ])

    await materializeDashboardLayoutFields(scope, 'layout-1', {
      name: 'Renamed',
      layout: nextLayout,
      colorPairs: nextColorPairs,
      isActive: true,
      sortOrder: 0,
    })

    expect(m.bridge.applyEntityStateInSocketServer).toHaveBeenCalledWith(
      'layout-1',
      'dashboard_layout',
      expect.objectContaining({
        name: 'Renamed',
        layout: nextLayout,
        colorPairs: nextColorPairs,
      }),
      'user-1'
    )
  })
})
