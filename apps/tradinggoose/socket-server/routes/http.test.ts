import type { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  buildEntityListDescriptor,
  buildSavedEntityDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { createHttpHandler } from './http'

const socketRouteMocks = vi.hoisted(() => ({
  saveDashboardLayoutYjsDocToDb: vi.fn(),
  saveSavedEntityYjsDocToDb: vi.fn(),
  createEntityListBootstrapUpdate: vi.fn(),
  createSavedReviewTargetBootstrapUpdate: vi.fn(),
  getRuntimeStateFromDoc: vi.fn(() => ({ docState: 'active' })),
  reseedEntityListSessionFromDb: vi.fn(),
  getDocument: vi.fn(),
  getExistingDocument: vi.fn(),
  markDocumentPersisted: vi.fn(),
  discardDocumentIfIdle: vi.fn(),
  discardDocument: vi.fn(),
  flushDocumentPersistence: vi.fn(),
  seedEntitySession: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'internal-secret' } }))
vi.mock('@/lib/workflows/db-helpers', () => ({ saveWorkflowYjsDocToDb: vi.fn() }))
vi.mock('@/lib/yjs/workflow-session', () => ({ replaceWorkflowDocumentState: vi.fn() }))
vi.mock('@/lib/yjs/workflow-variables', () => ({ replaceWorkflowVariables: vi.fn() }))
vi.mock('@/socket-server/monitor-runtime-lock', () => ({
  getMonitorRuntimeLockHealth: () => ({ degraded: false }),
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  SavedEntityPersistenceError: class SavedEntityPersistenceError extends Error {
    status = 422
  },
  saveDashboardLayoutYjsDocToDb: socketRouteMocks.saveDashboardLayoutYjsDocToDb,
  saveSavedEntityYjsDocToDb: socketRouteMocks.saveSavedEntityYjsDocToDb,
}))

// The shared bundle carries every export these two modules need, keyed by name.
vi.mock('@/lib/yjs/server/bootstrap-review-target', () => socketRouteMocks)
vi.mock('@/socket-server/yjs/upstream-utils', () => socketRouteMocks)

vi.mock('@/lib/yjs/entity-session', () => ({
  seedEntitySession: socketRouteMocks.seedEntitySession,
  getEntityWorkspaceId: (doc: any) => doc.getMap('metadata').get('workspaceId') ?? null,
  getEntityOwnerUserId: (doc: any) => doc.getMap('metadata').get('ownerUserId') ?? null,
}))

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }

function createDashboardDoc(ownerUserId = 'user-1') {
  const doc = new Y.Doc()
  const meta = { entityKind: 'dashboard_layout', entityId: 'layout-1', workspaceId: 'workspace-1' }
  for (const [key, value] of Object.entries({ ...meta, ownerUserId })) {
    doc.getMap('metadata').set(key, value)
  }
  return doc
}

async function invoke(method: string, url: string, body?: unknown) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  req.method = method
  req.url = url
  req.headers = { host: 'localhost', 'x-internal-secret': 'internal-secret' }

  const res = {
    statusCode: 0,
    body: '',
    headersSent: false,
    writableEnded: false,
    writeHead(status: number) {
      this.statusCode = status
      this.headersSent = true
      return this
    },
    end(chunk: string) {
      this.body = chunk
      this.writableEnded = true
      return this
    },
  }

  await createHttpHandler(logger)(req, res as ServerResponse & typeof res)
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

describe('socket internal HTTP Yjs routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    socketRouteMocks.saveDashboardLayoutYjsDocToDb.mockResolvedValue({ ok: true })
    socketRouteMocks.saveSavedEntityYjsDocToDb.mockResolvedValue({ ok: true })
    socketRouteMocks.flushDocumentPersistence.mockImplementation(
      async (doc: Y.Doc, persist: (docId: string, target: Y.Doc) => Promise<void>) => {
        await persist('layout-1', doc)
      }
    )
    socketRouteMocks.getDocument.mockImplementation(() => createDashboardDoc())
    socketRouteMocks.getExistingDocument.mockImplementation((sessionId: string) =>
      sessionId === 'layout-1' || sessionId.startsWith('list:dashboard_layout')
        ? createDashboardDoc()
        : null
    )
  })

  it('rejects dashboard documents on the generic entity apply route', async () => {
    const response = await invoke('POST', '/internal/yjs/entities/layout-1/apply-state', {
      entityKind: 'dashboard_layout',
      fields: { name: 'Desk' },
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Invalid entityKind')
    expect(socketRouteMocks.saveSavedEntityYjsDocToDb).not.toHaveBeenCalled()
  })

  it('rejects entityName outside the watchlist apply contract', async () => {
    const response = await invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
      entityKind: 'skill',
      fields: { description: '', content: '' },
      entityName: 'Renamed Skill',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('entityName is only supported for watchlist')
    expect(socketRouteMocks.saveSavedEntityYjsDocToDb).not.toHaveBeenCalled()
  })

  it('forwards dashboard owner scope when bootstrapping entity-list snapshots', async () => {
    const descriptor = buildEntityListDescriptor('dashboard_layout', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const envelope = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    const query = new URLSearchParams(envelope).toString()
    socketRouteMocks.getExistingDocument.mockReturnValueOnce(null)
    socketRouteMocks.createEntityListBootstrapUpdate.mockResolvedValueOnce({
      runtime: { docState: 'active' },
      state: Y.encodeStateAsUpdate(new Y.Doc()),
    })

    const response = await invoke(
      'GET',
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/snapshot?${query}`
    )

    expect(response.status).toBe(200)
    expect(socketRouteMocks.createEntityListBootstrapUpdate).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
    expect(response.body.descriptor.ownerUserId).toBe('user-1')
    expect(socketRouteMocks.discardDocumentIfIdle).toHaveBeenCalledWith(descriptor.yjsSessionId)
  })

  it('reuses a bootstrapped dashboard lineage for an explicit save', async () => {
    const descriptor = buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    let sharedDoc: Y.Doc | null = null
    let persistedTopology: unknown
    socketRouteMocks.saveDashboardLayoutYjsDocToDb.mockImplementationOnce(
      async (_entityId: string, target: Y.Doc) => {
        persistedTopology = target.getMap('layout').get('topology')
        return { ok: true }
      }
    )
    socketRouteMocks.getExistingDocument.mockImplementation(() => sharedDoc)
    socketRouteMocks.getDocument.mockImplementation(
      (_sessionId: string, _gc: boolean, bootstrapState?: Uint8Array) => {
        const doc = new Y.Doc()
        if (bootstrapState) Y.applyUpdate(doc, bootstrapState)
        sharedDoc = doc
        return doc
      }
    )
    socketRouteMocks.createSavedReviewTargetBootstrapUpdate.mockImplementationOnce(async () => {
      const source = createDashboardDoc()
      source.getMap('layout').set('topology', { id: 'before' })
      const state = Y.encodeStateAsUpdate(source)
      source.destroy()
      return { runtime: { docState: 'active' }, state }
    })
    socketRouteMocks.discardDocumentIfIdle.mockImplementation(() => {
      sharedDoc?.destroy()
      sharedDoc = null
    })

    const snapshot = await invoke('GET', `/internal/yjs/sessions/layout-1/snapshot?${query}`)
    const retainedDoc = sharedDoc
    expect(snapshot.status).toBe(200)
    expect(retainedDoc).toBeInstanceOf(Y.Doc)
    expect(socketRouteMocks.discardDocumentIfIdle).not.toHaveBeenCalled()

    const clientDoc = new Y.Doc()
    Y.applyUpdate(clientDoc, Buffer.from(snapshot.body.snapshotBase64, 'base64'))
    const stateVector = Y.encodeStateVector(clientDoc)
    clientDoc.getMap('layout').set('topology', { id: 'changed' })
    const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(clientDoc, stateVector)).toString(
      'base64'
    )

    const response = await invoke('POST', `/internal/yjs/sessions/layout-1/apply-update?${query}`, {
      updateBase64,
    })
    clientDoc.destroy()

    expect(response).toEqual({ status: 200, body: { success: true } })
    expect(socketRouteMocks.createSavedReviewTargetBootstrapUpdate).toHaveBeenCalledTimes(1)
    expect(socketRouteMocks.flushDocumentPersistence).toHaveBeenCalledWith(
      retainedDoc,
      expect.any(Function)
    )
    expect(socketRouteMocks.saveDashboardLayoutYjsDocToDb).toHaveBeenCalledWith(
      'layout-1',
      retainedDoc
    )
    expect(persistedTopology).toEqual({ id: 'changed' })
    expect(socketRouteMocks.discardDocumentIfIdle).toHaveBeenCalledWith('layout-1')
  })

  it('requests deferred idle cleanup when explicit dashboard persistence fails', async () => {
    const descriptor = buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    socketRouteMocks.flushDocumentPersistence.mockRejectedValueOnce(new Error('database offline'))

    const response = await invoke('POST', `/internal/yjs/sessions/layout-1/apply-update?${query}`, {
      updateBase64: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64'),
    })

    expect(response.status).toBe(500)
    expect(response.body.error).toBe('database offline')
    expect(socketRouteMocks.discardDocumentIfIdle).toHaveBeenCalledWith('layout-1')
  })
})
