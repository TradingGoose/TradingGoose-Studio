import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from '@/lib/copilot/tools/server/dashboard-layout/test-fixtures'
import { DASHBOARD_LAYOUT_DOCUMENT_FORMAT } from '@/widgets/layout-document'
import {
  createLayoutServerTool,
  listLayoutsServerTool,
  readLayoutServerTool,
} from './dashboard-layout'

const mocks = vi.hoisted(() => ({
  projection: vi.fn(),
  access: vi.fn(),
  entityAccess: vi.fn(),
  read: vi.fn(),
  metadata: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: mocks.entityAccess,
}))
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedDashboardLayoutProjection: mocks.read,
}))
vi.mock('@/lib/yjs/server/entity-loaders', () => ({ readEntityListMembersFromDb: mocks.list }))
vi.mock('@/lib/dashboard-layouts/operations', () => ({
  createDashboardLayout: mocks.create,
  readDashboardLayoutMetadata: mocks.metadata,
}))
vi.mock('@/lib/dashboard-layouts/read-projection', () => ({
  buildDashboardLayoutReadProjection: mocks.projection,
}))

const context = fx.TEST_EXECUTION_CONTEXT as any

describe('dashboard layout server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mocks.entityAccess.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-1' })
    mocks.metadata.mockResolvedValue({ name: 'Layout 1', isActive: true, sortOrder: 0 })
    mocks.list.mockResolvedValue([
      { id: 'layout-1', name: 'Layout 1', sortOrder: 0, isActive: true },
    ])
    mocks.read.mockResolvedValue(fx.createDashboardLayoutTestContent())
    mocks.create.mockResolvedValue({ id: 'layout-created', name: 'New Desk' })
    mocks.projection.mockImplementation((fields: any) => ({
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
      entityDocument: JSON.stringify(fields),
    }))
  })

  it('reads a dashboard layout from the live owner-scoped document', async () => {
    const result = await readLayoutServerTool.execute(
      { entityId: 'layout-1' },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(mocks.entityAccess).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        workspaceId: null,
        ownerUserId: 'user-1',
        entityKind: 'dashboard_layout',
        entityId: 'layout-1',
      }),
      'read'
    )
    expect(mocks.metadata).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1'
    )
    expect(mocks.read).toHaveBeenCalledWith('layout-1', 'workspace-1', 'user-1')
    expect(result).toMatchObject({
      entityKind: 'dashboard_layout',
      entityId: 'layout-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      entityName: 'Layout 1',
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    })
    expect(result).not.toHaveProperty('layoutName')
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { id: 'root', type: 'group' },
      widgets: {
        'chart-widget': { params: { data: { provider: 'alpaca' } } },
        'order-widget': { params: null },
      },
      colorPairs: { pairs: [expect.objectContaining({ color: 'red' })] },
    })
    expect(JSON.parse(result.entityDocument)).not.toHaveProperty('name')
  })

  it('rejects a layout outside the authenticated owner scope before reading its snapshot', async () => {
    mocks.entityAccess.mockResolvedValueOnce({ hasAccess: false, workspaceId: null })

    await expect(readLayoutServerTool.execute({ entityId: 'layout-1' }, context)).rejects.toThrow(
      'Access denied'
    )
    expect(mocks.metadata).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('lists owner-scoped dashboard layouts using the shared entities shape', async () => {
    const result = await listLayoutsServerTool.execute({ workspaceId: 'workspace-1' }, context)

    expect(mocks.list).toHaveBeenCalledWith('dashboard_layout', 'workspace-1', 'user-1')
    expect(result).toEqual({
      entityKind: 'dashboard_layout',
      entities: [{ entityId: 'layout-1', entityName: 'Layout 1', sortOrder: 0, isActive: true }],
      count: 1,
    })
  })

  it('stages create_layout with a complete aggregate preview', async () => {
    const result = await createLayoutServerTool.execute(
      { workspaceId: 'workspace-1', name: 'New Desk' },
      { ...context, accessLevel: 'limited' }
    )

    expect(result).toMatchObject({
      requiresReview: true,
      entityKind: 'dashboard_layout',
      entityName: 'New Desk',
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
      preview: { documentDiff: { before: '', after: expect.any(String) } },
    })
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { type: 'group' },
      widgets: {},
      colorPairs: { pairs: [] },
    })
  })

  it('returns the complete read_layout projection after creating a layout', async () => {
    const result = await createLayoutServerTool.execute(
      { workspaceId: 'workspace-1', name: 'New Desk' },
      { ...context, accessLevel: 'full' }
    )

    expect(mocks.create).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      { name: 'New Desk' }
    )
    expect(mocks.read).toHaveBeenCalledWith('layout-created', 'workspace-1', 'user-1')
    expect(result).toMatchObject({
      success: true,
      entityKind: 'dashboard_layout',
      entityId: 'layout-created',
      entityName: 'New Desk',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
      entityDocument: expect.any(String),
    })
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      layout: { id: 'root', type: 'group' },
      widgets: {
        'chart-widget': { params: { data: { provider: 'alpaca' } } },
        'order-widget': { params: null },
      },
      colorPairs: { pairs: [expect.objectContaining({ color: 'red' })] },
    })
  })

  it('rejects list_layout when the workspace arg conflicts with execution context', async () => {
    await expect(
      listLayoutsServerTool.execute({ workspaceId: 'workspace-2' }, context)
    ).rejects.toThrow('workspaceId does not match execution context')

    expect(mocks.list).not.toHaveBeenCalled()
  })
})
