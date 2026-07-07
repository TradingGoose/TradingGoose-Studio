import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getEntityListMembers } from '@/lib/yjs/entity-session'
import {
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
    readSavedEntityFieldsFromDb.mockResolvedValueOnce({ name: 'Layout 1' })

    await expect(
      readSavedEntityListFieldsForExecution('dashboard_layout', 'workspace-1', true, 'user-1')
    ).resolves.toEqual([
      expect.objectContaining({
        entityId: 'layout-1',
        entityName: 'Layout 1',
        sortOrder: 2,
        isActive: true,
        fields: { name: 'Layout 1' },
      }),
    ])
  })
})
