import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  beginDashboardLayoutDirtyFlush,
  completeDashboardLayoutDirtyFlush,
  failDashboardLayoutDirtyFlush,
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { createDefaultDashboardLayoutContent } from '@/widgets/layout-document'
import {
  cleanupAllDocuments,
  discardDocumentIfIdle,
  flushDocumentPersistence,
  getDocument,
  peekDocument,
} from './upstream-utils'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createDashboardDocument(docId: string): Y.Doc {
  const source = new Y.Doc()
  seedDashboardLayoutSession(source, createDefaultDashboardLayoutContent(), YJS_ORIGINS.SYSTEM)
  source.transact(() => {
    const metadata = source.getMap('metadata')
    metadata.set('entityKind', 'dashboard_layout')
    metadata.set('entityId', docId)
    metadata.set('workspaceId', 'workspace-1')
    metadata.set('ownerUserId', 'user-1')
  }, YJS_ORIGINS.SYSTEM)
  const state = Y.encodeStateAsUpdate(source)
  source.destroy()
  return getDocument(docId, true, state)
}

function changeTopology(doc: Y.Doc, id: string): void {
  getDashboardLayoutMap(doc).set('topology', {
    ...readDashboardLayoutTopology(doc),
    id,
  })
}

afterEach(() => {
  vi.useRealTimers()
  cleanupAllDocuments()
})

describe('dashboard document persistence queue', () => {
  it('serializes explicit flushes and preserves a newer generation during an in-flight save', async () => {
    const doc = createDashboardDocument('layout-serialized')
    const firstWrite = deferred()
    const savedTopologyIds: string[] = []
    let callCount = 0
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      const batch = beginDashboardLayoutDirtyFlush(target)
      expect(batch?.layout).toBe(true)
      callCount += 1
      savedTopologyIds.push(readDashboardLayoutTopology(target).id)
      if (callCount === 1) await firstWrite.promise
      completeDashboardLayoutDirtyFlush(target, batch!)
    })

    changeTopology(doc, 'first-generation')
    const firstFlush = flushDocumentPersistence(doc, persist)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))

    changeTopology(doc, 'second-generation')
    const secondFlush = flushDocumentPersistence(doc, persist)
    discardDocumentIfIdle('layout-serialized')
    expect(peekDocument('layout-serialized')).toBe(doc)

    firstWrite.resolve()
    await Promise.all([firstFlush, secondFlush])

    expect(persist).toHaveBeenCalledTimes(2)
    expect(savedTopologyIds).toEqual(['first-generation', 'second-generation'])
    discardDocumentIfIdle('layout-serialized')
    expect(peekDocument('layout-serialized')).toBeNull()
  })

  it('retries failed dirty state and completes requested idle cleanup', async () => {
    vi.useFakeTimers()
    const doc = createDashboardDocument('layout-retry')
    let attempts = 0
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      const batch = beginDashboardLayoutDirtyFlush(target)
      attempts += 1
      if (attempts === 1) {
        failDashboardLayoutDirtyFlush(target, batch!)
        throw new Error('database offline')
      }
      completeDashboardLayoutDirtyFlush(target, batch!)
    })

    changeTopology(doc, 'retry-generation')
    await expect(flushDocumentPersistence(doc, persist)).rejects.toThrow('database offline')
    discardDocumentIfIdle('layout-retry')
    expect(peekDocument('layout-retry')).toBe(doc)

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    expect(peekDocument('layout-retry')).toBeNull()
  })
})
