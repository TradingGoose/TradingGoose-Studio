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
  getEntityFields: vi.fn(),
  importWatchlistDocument: vi.fn(),
  applyDashboardTopologyMutation: vi.fn(),
  applyDashboardWidgetConfigPatch: vi.fn(),
  readDashboardLayoutContent: vi.fn(),
  runDocumentMutation: vi.fn(),
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

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  DashboardLayoutOperationError: class DashboardLayoutOperationError extends Error {},
}))

vi.mock('@/lib/yjs/dashboard-layout-session', () => ({
  applyDashboardTopologyMutation: socketRouteMocks.applyDashboardTopologyMutation,
  applyDashboardWidgetConfigPatch: socketRouteMocks.applyDashboardWidgetConfigPatch,
  readDashboardLayoutContent: socketRouteMocks.readDashboardLayoutContent,
}))

vi.mock('@/lib/watchlists/operations', () => ({
  WatchlistOperationError: class WatchlistOperationError extends Error {
    constructor(
      message: string,
      public status = 400
    ) {
      super(message)
    }
  },
  importWatchlistDocument: socketRouteMocks.importWatchlistDocument,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  seedEntitySession: socketRouteMocks.seedEntitySession,
  getEntityFields: socketRouteMocks.getEntityFields,
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
    socketRouteMocks.runDocumentMutation.mockImplementation(
      async (_doc: Y.Doc, mutation: () => Promise<unknown> | unknown) => mutation()
    )
    socketRouteMocks.discardDocumentIfIdle.mockImplementation(() => undefined)
    socketRouteMocks.discardDocument.mockImplementation(() => undefined)
    socketRouteMocks.saveDashboardLayoutYjsDocToDb.mockResolvedValue({ ok: true })
    socketRouteMocks.saveSavedEntityYjsDocToDb.mockResolvedValue({ ok: true })
    socketRouteMocks.flushDocumentPersistence.mockImplementation(
      async (doc: Y.Doc, persist?: (docId: string, target: Y.Doc) => Promise<void>) => {
        if (persist) await persist('layout-1', doc)
      }
    )
    socketRouteMocks.getDocument.mockImplementation(() => createDashboardDoc())
    socketRouteMocks.getExistingDocument.mockImplementation((sessionId: string) =>
      sessionId === 'layout-1' || sessionId.startsWith('list:dashboard_layout')
        ? createDashboardDoc()
        : null
    )
    socketRouteMocks.seedEntitySession.mockImplementation((doc: Y.Doc, options: any) => {
      doc.getMap('test').set('fields', options.payload)
    })
    socketRouteMocks.getEntityFields.mockImplementation((doc: Y.Doc) =>
      doc.getMap('test').get('fields')
    )
    socketRouteMocks.readDashboardLayoutContent.mockReturnValue({
      layout: {
        id: 'panel-1',
        type: 'panel',
        identityId: 'widget-1',
        widgetKey: 'copilot',
      },
      widgets: { 'widget-1': { pairColor: 'gray', params: null } },
      colorPairs: { pairs: [] },
    })
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

  it('rejects the removed entityName apply-state field', async () => {
    const response = await invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
      entityKind: 'skill',
      fields: { description: '', content: '' },
      entityName: 'Renamed Skill',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Unsupported apply entity state field: entityName')
    expect(socketRouteMocks.saveSavedEntityYjsDocToDb).not.toHaveBeenCalled()
  })

  it('applies MCP credentials directly through the saved-entity document contract', async () => {
    const doc = createDashboardDoc()
    doc.getMap('metadata').set('entityKind', 'mcp_server')
    doc.getMap('metadata').set('entityId', 'mcp-1')
    doc.getMap('metadata').delete('ownerUserId')
    doc.getMap('test').set('fields', {
      description: 'Current',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer stored' },
      command: '',
      args: [],
      env: { TOKEN: 'stored-token' },
      timeout: 30000,
      retries: 3,
      enabled: true,
    })
    socketRouteMocks.getExistingDocument.mockResolvedValue(doc)

    const response = await invoke('POST', '/internal/yjs/entities/mcp-1/apply-state', {
      entityKind: 'mcp_server',
      fields: {
        description: 'Updated',
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer replacement' },
        command: '',
        args: [],
        env: { TOKEN: 'replacement-token' },
        timeout: 30000,
        retries: 3,
        enabled: true,
      },
    })

    expect(response.status).toBe(200)
    expect(response.body.fields).toMatchObject({
      headers: { Authorization: 'Bearer replacement' },
      env: { TOKEN: 'replacement-token' },
    })
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

  it('rejects an accepted layout edit after its doomed widget document changes', async () => {
    const { hashServerToolReviewBase } = await import('@/lib/copilot/tools/server/base-tool')
    const { buildDashboardLayoutReviewBase } = await import('@/lib/dashboard-layouts/review-base')
    const { applyLayoutEditDocument } = await import('@/widgets/layout-document')
    const entityDocument = JSON.stringify({
      layout: { id: 'panel-1', type: 'panel', widget: { key: 'watchlist' } },
    })
    const reviewed = {
      ...socketRouteMocks.readDashboardLayoutContent(),
      layout: {
        id: 'panel-1',
        type: 'panel' as const,
        identityId: 'widget-1',
        widgetKey: 'data_chart' as const,
      },
      widgets: {
        'widget-1': { pairColor: 'gray' as const, params: { view: { interval: '15m' } } },
      },
    }
    const plan = applyLayoutEditDocument(reviewed, entityDocument)
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardLayoutReviewBase(reviewed, plan)
    )
    socketRouteMocks.readDashboardLayoutContent.mockReturnValue({
      ...reviewed,
      widgets: {
        ...reviewed.widgets,
        'widget-1': { pairColor: 'gray', params: { view: { interval: '1h' } } },
      },
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'layout',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      entityDocument,
      removedPanelIds: [],
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('stale_server_tool_review')
    expect(socketRouteMocks.applyDashboardTopologyMutation).not.toHaveBeenCalled()
    expect(socketRouteMocks.flushDocumentPersistence).not.toHaveBeenCalled()
  })

  it('applies an accepted widget edit through the canonical dashboard patch helper', async () => {
    const { hashServerToolReviewBase } = await import('@/lib/copilot/tools/server/base-tool')
    const { buildDashboardWidgetReviewBase } = await import('@/lib/dashboard-layouts/review-base')
    const { applyWidgetConfigMutation } = await import('@/widgets/widget-mutations')
    const content = socketRouteMocks.readDashboardLayoutContent()
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'copilot',
      widget: content.widgets['widget-1'],
      colorPairs: content.colorPairs,
      panelId: 'panel-1',
      patch: { pairColor: 'blue' },
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(content, 'panel-1', mutation.reviewBase, {
        pairColor: 'blue',
      })
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch: { pairColor: 'blue' },
    })

    expect(response.status).toBe(200)
    expect(socketRouteMocks.applyDashboardWidgetConfigPatch).toHaveBeenCalledWith(
      expect.any(Y.Doc),
      'panel-1',
      { pairColor: 'blue', params: undefined, colorPair: undefined }
    )
    expect(socketRouteMocks.flushDocumentPersistence).toHaveBeenCalledTimes(1)
  })

  it('preserves the latest credential when accepting a redacted widget patch', async () => {
    const { hashServerToolReviewBase } = await import('@/lib/copilot/tools/server/base-tool')
    const { buildDashboardWidgetReviewBase } = await import('@/lib/dashboard-layouts/review-base')
    const { applyWidgetConfigMutation } = await import('@/widgets/widget-mutations')
    const patch = { params: { data: { auth: { apiKey: '[redacted]' } } } }
    const reviewed = {
      layout: {
        id: 'panel-1',
        type: 'panel' as const,
        identityId: 'widget-1',
        widgetKey: 'data_chart' as const,
      },
      widgets: {
        'widget-1': {
          pairColor: 'gray' as const,
          params: {
            data: { auth: { apiKey: 'reviewed-key', apiSecret: 'shared-secret' } },
          },
        },
      },
      colorPairs: { pairs: [] },
    }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: reviewed.widgets['widget-1'],
      colorPairs: reviewed.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(reviewed, 'panel-1', mutation.reviewBase, patch)
    )
    socketRouteMocks.readDashboardLayoutContent.mockReturnValue({
      ...reviewed,
      widgets: {
        'widget-1': {
          ...reviewed.widgets['widget-1'],
          params: {
            data: { auth: { apiKey: 'latest-key', apiSecret: 'shared-secret' } },
          },
        },
      },
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response.status).toBe(200)
    expect(socketRouteMocks.applyDashboardWidgetConfigPatch).toHaveBeenCalledWith(
      expect.any(Y.Doc),
      'panel-1',
      {
        pairColor: undefined,
        params: { data: { auth: { apiKey: 'latest-key' } } },
        colorPair: undefined,
      }
    )
  })

  it('rejects an accepted widget edit after its destination color-pair field changes', async () => {
    const { hashServerToolReviewBase } = await import('@/lib/copilot/tools/server/base-tool')
    const { buildDashboardWidgetReviewBase } = await import('@/lib/dashboard-layouts/review-base')
    const { applyWidgetConfigMutation } = await import('@/widgets/widget-mutations')
    const listing = (listingId: string) => ({
      listing_type: 'default' as const,
      listing_id: listingId,
      base_id: '',
      quote_id: '',
    })
    const patch = { pairColor: 'blue', colorPair: { listing: listing('NVDA') } }
    const reviewed = {
      layout: {
        id: 'panel-1',
        type: 'panel' as const,
        identityId: 'widget-1',
        widgetKey: 'data_chart' as const,
      },
      widgets: { 'widget-1': { pairColor: 'red' as const, params: null } },
      colorPairs: {
        pairs: [
          { color: 'blue' as const, listing: listing('MSFT') },
          { color: 'red' as const, listing: listing('AAPL') },
        ],
      },
    }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: reviewed.widgets['widget-1'],
      colorPairs: reviewed.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(reviewed, 'panel-1', mutation.reviewBase, patch)
    )
    socketRouteMocks.readDashboardLayoutContent.mockReturnValue({
      ...reviewed,
      colorPairs: {
        pairs: [
          { color: 'blue', listing: listing('GOOG') },
          { color: 'red', listing: listing('AAPL') },
        ],
      },
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('stale_server_tool_review')
    expect(socketRouteMocks.applyDashboardWidgetConfigPatch).not.toHaveBeenCalled()
    expect(socketRouteMocks.flushDocumentPersistence).not.toHaveBeenCalled()
  })
})
