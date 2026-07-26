import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import {
  createSavedReviewTargetBootstrapUpdate,
  readSavedEntityListFieldsForExecution,
} from './bootstrap-review-target'

const {
  loadWorkflowBootstrapStateFromDb,
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb,
} = vi.hoisted(() => ({
  loadWorkflowBootstrapStateFromDb: vi.fn(),
  readEntityListMembersFromDb: vi.fn(),
  readSavedEntityFieldsFromDb: vi.fn(),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({ loadWorkflowBootstrapStateFromDb }))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb,
  resolveEntityWorkspaceId: vi.fn(),
}))

const dashboardContent = {
  layout: {
    id: 'panel-1',
    type: 'panel' as const,
    identityId: 'widget-1',
    widgetKey: null,
  },
}
describe('reseedEntityListSessionFromDb', () => {
  beforeEach(() => {
    loadWorkflowBootstrapStateFromDb.mockReset()
    readEntityListMembersFromDb.mockReset()
    readSavedEntityFieldsFromDb.mockReset()
  })

  it('preserves dashboard layout list metadata for deployed execution reads', async () => {
    readEntityListMembersFromDb.mockResolvedValueOnce([
      {
        id: 'layout-1',
        name: 'Layout 1',
        sortOrder: 2,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    readSavedEntityFieldsFromDb.mockResolvedValueOnce(dashboardContent)

    await expect(
      readSavedEntityListFieldsForExecution('dashboard_layout', 'workspace-1', true, 'user-1')
    ).resolves.toEqual([
      expect.objectContaining({
        entityId: 'layout-1',
        entityName: 'Layout 1',
        sortOrder: 2,
        isActive: true,
        fields: dashboardContent,
      }),
    ])
  })

  it('bootstraps dashboard sessions from content without generic fields or row metadata', async () => {
    const descriptor = buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    readSavedEntityFieldsFromDb.mockResolvedValueOnce(dashboardContent)

    const result = await createSavedReviewTargetBootstrapUpdate(descriptor)
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, result.state)
      const { readDashboardLayoutDocument } = await import('@/lib/yjs/dashboard-layout-session')
      expect(readDashboardLayoutDocument(doc)).toEqual(dashboardContent)
      expect(doc.share.has('fields')).toBe(false)
      expect(doc.getMap('layout').has('name')).toBe(false)
      expect(doc.getMap('layout').has('isActive')).toBe(false)
      expect(doc.getMap('layout').has('sortOrder')).toBe(false)
    } finally {
      doc.destroy()
    }
    readSavedEntityFieldsFromDb.mockResolvedValueOnce({ layout: {} })
    await expect(createSavedReviewTargetBootstrapUpdate(descriptor)).rejects.toMatchObject({
      status: 409,
    })
    readSavedEntityFieldsFromDb.mockResolvedValueOnce({
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [],
    })
    const watchlist = await createSavedReviewTargetBootstrapUpdate(
      buildSavedEntityDescriptor('watchlist', 'watchlist-1', 'workspace-1')
    )
    const invalid = new Y.Doc()
    try {
      expect(() => watchlist.validateDocument?.(invalid)).toThrow()
    } finally {
      invalid.destroy()
    }
  })

  it('resolves workflow workspace ownership from its bootstrap row', async () => {
    loadWorkflowBootstrapStateFromDb.mockResolvedValue({
      workspaceId: 'workspace-db',
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: 0,
    })

    const resolved = await createSavedReviewTargetBootstrapUpdate(
      buildSavedEntityDescriptor('workflow', 'workflow-1', null)
    )
    const explicit = await createSavedReviewTargetBootstrapUpdate(
      buildSavedEntityDescriptor('workflow', 'workflow-1', 'workspace-explicit')
    )

    expect(resolved.descriptor.workspaceId).toBe('workspace-db')
    expect(explicit.descriptor.workspaceId).toBe('workspace-explicit')
  })
})
