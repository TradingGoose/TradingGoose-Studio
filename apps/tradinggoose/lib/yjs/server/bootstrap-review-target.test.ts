import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { getEntityListMembers } from '@/lib/yjs/entity-session'
import {
  createSavedReviewTargetBootstrapUpdate,
  readSavedEntityListFieldsForExecution,
  reseedEntityListSessionFromDb,
} from './bootstrap-review-target'

const { readEntityListMembersFromDb, readSavedEntityFieldsFromDb } = vi.hoisted(() => ({
  readEntityListMembersFromDb: vi.fn(),
  readSavedEntityFieldsFromDb: vi.fn(),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb,
  resolveEntityWorkspaceId: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

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
    readEntityListMembersFromDb.mockReset()
    readSavedEntityFieldsFromDb.mockReset()
  })

  it('serializes destructive full reseeds for the same list document', async () => {
    const olderSnapshot = deferred<Array<{ id: string; name: string }>>()
    const newerSnapshot = deferred<Array<{ id: string; name: string }>>()
    readEntityListMembersFromDb
      .mockReturnValueOnce(olderSnapshot.promise)
      .mockReturnValueOnce(newerSnapshot.promise)

    const doc = new Y.Doc()
    try {
      const first = reseedEntityListSessionFromDb(doc, 'workflow', 'workspace-1')
      const second = reseedEntityListSessionFromDb(doc, 'workflow', 'workspace-1')

      await flushMicrotasks()
      expect(readEntityListMembersFromDb).toHaveBeenCalledTimes(1)

      olderSnapshot.resolve([{ id: 'workflow-1', name: 'Workflow 1' }])
      await first
      await flushMicrotasks()
      expect(readEntityListMembersFromDb).toHaveBeenCalledTimes(2)

      newerSnapshot.resolve([
        { id: 'workflow-1', name: 'Workflow 1' },
        { id: 'workflow-2', name: 'Workflow 2' },
      ])
      await second

      expect(getEntityListMembers(doc, 'workflow').map((member) => member.entityId)).toEqual([
        'workflow-1',
        'workflow-2',
      ])
    } finally {
      doc.destroy()
    }
  })

  it('reports the current reseed failure while allowing the next queued reseed to run', async () => {
    readEntityListMembersFromDb
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([{ id: 'workflow-2', name: 'Workflow 2' }])

    const doc = new Y.Doc()
    try {
      const first = reseedEntityListSessionFromDb(doc, 'workflow', 'workspace-1')
      const second = reseedEntityListSessionFromDb(doc, 'workflow', 'workspace-1')

      await expect(first).rejects.toThrow('database unavailable')
      await second

      expect(readEntityListMembersFromDb).toHaveBeenCalledTimes(2)
      expect(getEntityListMembers(doc, 'workflow').map((member) => member.entityId)).toEqual([
        'workflow-2',
      ])
    } finally {
      doc.destroy()
    }
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
    readSavedEntityFieldsFromDb.mockResolvedValueOnce(dashboardContent)

    const result = await createSavedReviewTargetBootstrapUpdate(
      buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
        ownerUserId: 'user-1',
      })
    )
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
  })
})
