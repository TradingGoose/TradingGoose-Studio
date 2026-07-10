import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDashboardLayout,
  deleteDashboardLayout,
  ensureDashboardLayoutProvisioned,
  materializeDashboardLayoutContent,
  readDashboardLayoutMetadata,
  readPersistedDashboardLayoutContent,
} from '@/lib/dashboard-layouts/operations'
import type { PersistedColorPairsState } from '@/widgets/layout'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'

const m = vi.hoisted(() => {
  const selectRows = vi.fn()
  const insertRows = vi.fn()
  const updateRows = vi.fn()
  const updateValues: unknown[] = []
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
    set: vi.fn((values) => {
      updateValues.push(values)
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => updateRows()),
        })),
      }
    }),
  }))
  const txInsert = vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn(() => insertRows()) })),
  }))
  const txDelete = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
  return {
    selectRows,
    insertRows,
    updateRows,
    txDelete,
    txExecute,
    txInsert,
    txUpdate,
    updateValues,
    db: {
      select,
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
      update: txUpdate,
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
  sql: vi.fn(),
}))

vi.mock('@/lib/dashboard-layouts/read-projection', () => ({
  buildDashboardLayoutReadProjection: vi.fn(async (fields) => ({
    hydratedLayout: fields.layout,
    hydratedColorPairs: fields.colorPairs,
    canonicalContent: fields,
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
    layout: {
      id: 'panel-1',
      type: 'panel',
      identityId: null,
      widgetKey: null,
    },
    widgets: {},
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
    m.updateRows.mockReset()
    m.updateValues.length = 0
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

  it('reads persisted content and row metadata through separate contracts', async () => {
    m.selectRows.mockResolvedValueOnce([row({ name: 'Desk', sort_order: 3, isActive: false })])

    await expect(readPersistedDashboardLayoutContent(scope, 'layout-1')).resolves.toEqual({
      layout: row().layout.layout,
      widgets: {},
      colorPairs: { pairs: [] },
    })

    m.selectRows.mockResolvedValueOnce([row({ name: 'Desk', sort_order: 3, isActive: false })])
    await expect(readDashboardLayoutMetadata(scope, 'layout-1')).resolves.toEqual({
      name: 'Desk',
      sortOrder: 3,
      isActive: false,
    })
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

  it('persists layout content without carrying row metadata into the document', async () => {
    const nextLayout: DashboardLayoutTopologyNode = {
      id: 'panel-next',
      type: 'panel',
      identityId: null,
      widgetKey: null,
    }
    const nextColorPairs: PersistedColorPairsState = {
      pairs: [{ color: 'red', workflowId: 'workflow-1' }],
    }
    m.updateRows.mockResolvedValueOnce([
      row({
        name: 'Concurrent Rename',
        isActive: false,
        sort_order: 2,
        layout: { layout: nextLayout, widgets: {} },
        color_pair: nextColorPairs,
      }),
    ])

    await materializeDashboardLayoutContent(scope, 'layout-1', {
      layout: nextLayout,
      widgets: {},
      colorPairs: nextColorPairs,
    })

    expect(m.updateValues).toEqual([
      {
        layout: { layout: nextLayout, widgets: {} },
        color_pair: nextColorPairs,
        updatedAt: expect.any(Date),
      },
    ])
    expect(m.bridge.applyEntityStateInSocketServer).not.toHaveBeenCalled()
    expect(m.bridge.refreshEntityListSession).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
  })

  it('rejects invalid topology-to-widget references before acquiring the owner lock', async () => {
    await expect(
      materializeDashboardLayoutContent(scope, 'layout-1', {
        layout: {
          id: 'panel-1',
          type: 'panel',
          identityId: 'missing-widget',
          widgetKey: 'data_chart',
        },
        widgets: {},
        colorPairs: { pairs: [] },
      })
    ).rejects.toThrow('dashboard layout references missing widget missing-widget')

    expect(m.txExecute).not.toHaveBeenCalled()
    expect(m.txUpdate).not.toHaveBeenCalled()
  })
})
