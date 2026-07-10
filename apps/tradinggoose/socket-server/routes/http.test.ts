import type { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  buildEntityListDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { createHttpHandler } from './http'

const socketRouteMocks = vi.hoisted(() => ({
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
    socketRouteMocks.saveSavedEntityYjsDocToDb.mockResolvedValue({ ok: true })
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
  })
})
