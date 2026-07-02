import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getEntityListMembers } from '@/lib/yjs/entity-session'

const { readEntityListMembersFromDb } = vi.hoisted(() => ({
  readEntityListMembersFromDb: vi.fn(),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb: vi.fn(),
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
  it('serializes destructive full reseeds for the same list document', async () => {
    const olderSnapshot = deferred<Array<{ id: string; name: string }>>()
    const newerSnapshot = deferred<Array<{ id: string; name: string }>>()
    readEntityListMembersFromDb
      .mockReturnValueOnce(olderSnapshot.promise)
      .mockReturnValueOnce(newerSnapshot.promise)

    const { reseedEntityListSessionFromDb } = await import('./bootstrap-review-target')
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

      expect(getEntityListMembers(doc).map((member) => member.entityId)).toEqual([
        'workflow-1',
        'workflow-2',
      ])
    } finally {
      doc.destroy()
    }
  })
})
