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
  read: vi.fn(),
  list: vi.fn(),
  verify: vi.fn(),
}))

vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: mocks.verify,
}))
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedSavedEntityFields: mocks.read,
}))
vi.mock('@/lib/yjs/server/entity-loaders', () => ({ readEntityListMembersFromDb: mocks.list }))
vi.mock('@/lib/dashboard-layouts/read-projection', () => ({
  buildDashboardLayoutReadProjection: mocks.projection,
}))

const context = fx.TEST_EXECUTION_CONTEXT as any

describe('dashboard layout server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mocks.verify.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-1' })
    mocks.list.mockResolvedValue([
      { id: 'layout-1', name: 'Layout 1', sortOrder: 0, isActive: true },
    ])
    mocks.read.mockResolvedValue(fx.createDashboardLayoutTestContent())
    mocks.projection.mockImplementation(async (fields: any) => ({
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
      entityDocument: JSON.stringify(fields),
      effectiveLayout: fields.layout,
    }))
  })

  it('reads a dashboard layout from the live owner-scoped document', async () => {
    const result = await readLayoutServerTool.execute({ entityId: 'layout-1' }, context)

    expect(mocks.verify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        entityKind: 'dashboard_layout',
        entityId: 'layout-1',
        ownerUserId: 'user-1',
        workspaceId: 'workspace-1',
        yjsSessionId: 'layout-1',
      }),
      'read'
    )
    expect(mocks.read).toHaveBeenCalledWith('dashboard_layout', 'layout-1', 'workspace-1', 'user-1')
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
    expect(result.effectiveLayout).toMatchObject({ id: 'root', type: 'group' })
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

  it('rejects list_layout when the workspace arg conflicts with execution context', async () => {
    await expect(
      listLayoutsServerTool.execute({ workspaceId: 'workspace-2' }, context)
    ).rejects.toThrow('workspaceId does not match execution context')

    expect(mocks.list).not.toHaveBeenCalled()
  })
})
