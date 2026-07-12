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
import { hashServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
} from '@/lib/dashboard-layouts/review-base'
import {
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
  setDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import {
  applyLayoutEditDocument,
  type DashboardLayoutProjectionContent,
} from '@/widgets/layout-document'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'
import { createHttpHandler } from './http'

const mocks = vi.hoisted(() => ({
  saveDashboardWidget: vi.fn(),
  saveDashboardPair: vi.fn(),
  saveEntity: vi.fn(),
  createListBootstrap: vi.fn(),
  createTargetBootstrap: vi.fn(),
  getRuntime: vi.fn(() => ({ docState: 'active' })),
  reseedList: vi.fn(),
  getDocument: vi.fn(),
  getExistingDocument: vi.fn(),
  markPersisted: vi.fn(),
  discardIfCurrent: vi.fn(),
  discardIfIdle: vi.fn(),
  discard: vi.fn(),
  flushPersistence: vi.fn(),
  runMutation: vi.fn(),
  reconcileWorkspaceConnections: vi.fn(),
  seedEntity: vi.fn(),
  getEntityFields: vi.fn(),
  importWatchlist: vi.fn(),
  commitDashboardStructure: vi.fn(),
  beginDeletion: vi.fn(),
  commitDeletion: vi.fn(),
  abortDeletion: vi.fn(),
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
    responseBody() {
      return { error: this.message }
    }
  },
  saveDashboardWidgetYjsDocToDb: mocks.saveDashboardWidget,
  saveDashboardColorPairYjsDocToDb: mocks.saveDashboardPair,
  saveSavedEntityYjsDocToDb: mocks.saveEntity,
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  createEntityListBootstrapUpdate: mocks.createListBootstrap,
  createSavedReviewTargetBootstrapUpdate: mocks.createTargetBootstrap,
  getRuntimeStateFromDoc: mocks.getRuntime,
  reseedEntityListSessionFromDb: mocks.reseedList,
}))

vi.mock('@/socket-server/yjs/upstream-utils', () => ({
  YjsSessionAdmissionError: class YjsSessionAdmissionError extends Error {},
  abortYjsSessionDeletion: mocks.abortDeletion,
  beginYjsSessionDeletion: mocks.beginDeletion,
  commitYjsSessionDeletion: mocks.commitDeletion,
  getDocument: mocks.getDocument,
  getExistingDocument: mocks.getExistingDocument,
  markDocumentPersisted: mocks.markPersisted,
  discardDocumentIfCurrent: mocks.discardIfCurrent,
  discardDocumentIfIdle: mocks.discardIfIdle,
  discardDocument: mocks.discard,
  flushDocumentPersistence: mocks.flushPersistence,
  runDocumentMutation: mocks.runMutation,
  reconcileWorkspaceConnections: mocks.reconcileWorkspaceConnections,
}))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  DashboardLayoutOperationError: class DashboardLayoutOperationError extends Error {},
  commitDashboardLayoutStructure: mocks.commitDashboardStructure,
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
  importWatchlistDocument: mocks.importWatchlist,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  seedEntitySession: mocks.seedEntity,
  getEntityFields: mocks.getEntityFields,
  getEntityWorkspaceId: (doc: Y.Doc) => doc.getMap('metadata').get('workspaceId') ?? null,
  getEntityOwnerUserId: (doc: Y.Doc) => doc.getMap('metadata').get('ownerUserId') ?? null,
}))

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
let documents = new Map<string, Y.Doc>()

function setMetadata(
  doc: Y.Doc,
  values: {
    entityKind: string
    entityId: string
    workspaceId?: string
    ownerUserId?: string
  }
) {
  for (const [key, value] of Object.entries(values)) doc.getMap('metadata').set(key, value)
}

function createLayoutDoc(
  layout: Parameters<typeof seedDashboardLayoutSession>[1]['layout'] = {
    id: 'panel-1',
    type: 'panel',
    identityId: 'widget-1',
    widgetKey: 'data_chart',
  }
) {
  const doc = new Y.Doc()
  seedDashboardLayoutSession(doc, { layout })
  setMetadata(doc, {
    entityKind: 'dashboard_layout',
    entityId: 'layout-1',
    workspaceId: 'workspace-1',
    ownerUserId: 'user-1',
  })
  return doc
}

function createWidgetDoc(
  pairColor: 'gray' | 'red' | 'blue' = 'gray',
  params: Record<string, unknown> | null = null
) {
  const doc = new Y.Doc()
  seedDashboardWidgetSession(doc, { pairColor, params })
  return doc
}

function createPairDoc(context: Record<string, unknown> = {}) {
  const doc = new Y.Doc()
  seedDashboardColorPairSession(doc, context)
  return doc
}

function setDashboardDocuments(input?: {
  layout?: Y.Doc
  widget?: Y.Doc
  red?: Y.Doc
  blue?: Y.Doc
}) {
  documents.set('layout-1', input?.layout ?? createLayoutDoc())
  documents.set('dashboard-widget:layout-1:widget-1', input?.widget ?? createWidgetDoc())
  if (input?.red) documents.set('dashboard-color-pair:layout-1:red', input.red)
  if (input?.blue) documents.set('dashboard-color-pair:layout-1:blue', input.blue)
}

function snapshotOf(doc: Y.Doc) {
  return {
    descriptor: {},
    runtime: { docState: 'active' },
    state: Y.encodeStateAsUpdate(doc),
  }
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

function dashboardProjection(input?: {
  widget?: ReturnType<typeof readDashboardWidgetDocument>
  red?: Record<string, unknown>
  blue?: Record<string, unknown>
}): DashboardLayoutProjectionContent {
  return {
    layout: readDashboardLayoutDocument(documents.get('layout-1')!).layout,
    widgets: {
      'widget-1':
        input?.widget ??
        readDashboardWidgetDocument(
          documents.get('dashboard-widget:layout-1:widget-1')!,
          'data_chart'
        ),
    },
    colorPairs: {
      pairs: [
        ...(input?.red ? [{ color: 'red' as const, ...input.red }] : []),
        ...(input?.blue ? [{ color: 'blue' as const, ...input.blue }] : []),
      ],
    },
  }
}

describe('socket internal HTTP Yjs routes', () => {
  beforeEach(() => {
    for (const doc of documents.values()) doc.destroy()
    documents = new Map()
    vi.clearAllMocks()
    mocks.runMutation.mockImplementation(
      async (_doc: Y.Doc, mutation: () => Promise<unknown> | unknown) => mutation()
    )
    mocks.flushPersistence.mockResolvedValue(undefined)
    mocks.discardIfCurrent.mockResolvedValue(undefined)
    mocks.discardIfIdle.mockImplementation(() => undefined)
    mocks.discard.mockResolvedValue(undefined)
    mocks.saveDashboardWidget.mockResolvedValue({ ok: true })
    mocks.saveDashboardPair.mockResolvedValue({ ok: true })
    mocks.beginDeletion.mockResolvedValue('deletion-1')
    mocks.commitDashboardStructure.mockImplementation(
      async (_scope: unknown, _layoutId: string, commit: { layout: unknown }) => ({
        layout: commit.layout,
      })
    )
    mocks.saveEntity.mockImplementation(async (_kind: string, _id: string, doc: Y.Doc) =>
      doc.getMap('test').get('fields')
    )
    mocks.getExistingDocument.mockImplementation((sessionId: string) =>
      Promise.resolve(documents.get(sessionId) ?? null)
    )
    mocks.getDocument.mockImplementation((sessionId: string, _gc: boolean, state?: Uint8Array) => {
      const existing = documents.get(sessionId)
      if (existing) return { doc: existing, created: false }
      const doc = new Y.Doc()
      if (state) Y.applyUpdate(doc, state)
      documents.set(sessionId, doc)
      return { doc, created: true }
    })
    mocks.createTargetBootstrap.mockImplementation(async (descriptor: { entityKind: string }) => {
      const source =
        descriptor.entityKind === 'dashboard_color_pair'
          ? createPairDoc()
          : descriptor.entityKind === 'dashboard_widget'
            ? createWidgetDoc()
            : createLayoutDoc()
      const snapshot = snapshotOf(source)
      source.destroy()
      return snapshot
    })
    mocks.seedEntity.mockImplementation((doc: Y.Doc, options: { payload: unknown }) => {
      doc.getMap('test').set('fields', options.payload)
    })
    mocks.getEntityFields.mockImplementation((doc: Y.Doc) => doc.getMap('test').get('fields'))
  })

  it('rejects dashboard documents on the generic entity apply route', async () => {
    const response = await invoke('POST', '/internal/yjs/entities/layout-1/apply-state', {
      entityKind: 'dashboard_layout',
      fields: { name: 'Desk' },
    })
    expect(response).toMatchObject({ status: 400, body: { error: 'Invalid entityKind' } })
    expect(mocks.saveEntity).not.toHaveBeenCalled()
  })

  it('checks accepted entity review hashes inside the queued mutation', async () => {
    const doc = new Y.Doc()
    setMetadata(doc, {
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
    })
    doc.getMap('test').set('fields', { description: 'Changed', content: 'Current' })
    documents.set('skill-1', doc)

    const response = await invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
      entityKind: 'skill',
      fields: { description: 'Reviewed', content: 'Next' },
      expectedReviewBaseStateHash: 'stale-review-hash',
    })
    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveEntity).not.toHaveBeenCalled()
  })

  it('forwards layout owner scope and reclaims snapshot-only list documents', async () => {
    const descriptor = buildEntityListDescriptor('dashboard_layout', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    const source = new Y.Doc()
    mocks.createListBootstrap.mockResolvedValueOnce(snapshotOf(source))

    const response = await invoke(
      'GET',
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/snapshot?${query}`
    )
    source.destroy()

    expect(response.status).toBe(200)
    expect(mocks.createListBootstrap).toHaveBeenCalledWith(
      'dashboard_layout',
      'workspace-1',
      'user-1'
    )
    expect(mocks.discardIfIdle).toHaveBeenCalledWith(expect.any(Y.Doc))
  })

  it('discards the exact entity-list document when a members reseed fails', async () => {
    const descriptor = buildEntityListDescriptor('skill', 'workspace-1')
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    const liveDoc = new Y.Doc()
    documents.set(descriptor.yjsSessionId, liveDoc)
    mocks.reseedList.mockRejectedValueOnce(new Error('database offline'))

    const response = await invoke(
      'POST',
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/members?${query}`,
      {}
    )

    expect(response).toMatchObject({ status: 500, body: { error: 'database offline' } })
    expect(mocks.discardIfCurrent).toHaveBeenCalledWith(liveDoc)
    expect(mocks.discard).not.toHaveBeenCalled()
  })

  it('rejects an entity-list snapshot after exact-instance reseed cleanup', async () => {
    const descriptor = buildEntityListDescriptor('skill', 'workspace-1')
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    const liveDoc = new Y.Doc()
    documents.set(descriptor.yjsSessionId, liveDoc)
    mocks.reseedList.mockRejectedValueOnce(new Error('database offline'))

    const response = await invoke(
      'GET',
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/snapshot?${query}`
    )

    expect(response).toMatchObject({ status: 500, body: { error: 'database offline' } })
    expect(mocks.discardIfCurrent).toHaveBeenCalledWith(liveDoc)
    expect(mocks.getRuntime).not.toHaveBeenCalled()
  })

  it('reclaims the exact request-created document when snapshot serialization fails', async () => {
    const descriptor = buildSavedEntityDescriptor('skill', 'skill-1', 'workspace-1')
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    mocks.getRuntime.mockImplementationOnce(() => {
      throw new Error('runtime projection failed')
    })

    const response = await invoke(
      'GET',
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/snapshot?${query}`
    )

    expect(response).toMatchObject({
      status: 500,
      body: { error: 'runtime projection failed' },
    })
    expect(mocks.discardIfIdle).toHaveBeenCalledTimes(1)
    expect(mocks.discardIfIdle).toHaveBeenCalledWith(documents.get(descriptor.yjsSessionId))
  })

  it('reclaims a snapshot-only layout and rejects a later generic apply', async () => {
    const descriptor = buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    mocks.createTargetBootstrap.mockImplementation(async (target: { entityKind: string }) => {
      const source =
        target.entityKind === 'dashboard_widget'
          ? createWidgetDoc()
          : target.entityKind === 'dashboard_color_pair'
            ? createPairDoc()
            : createLayoutDoc({
                id: 'panel-before',
                type: 'panel',
                identityId: 'widget-before',
                widgetKey: null,
              })
      const snapshot = snapshotOf(source)
      source.destroy()
      return snapshot
    })
    mocks.discardIfIdle.mockImplementation((doc: Y.Doc) => {
      for (const [sessionId, current] of documents) {
        if (current !== doc) continue
        current.destroy()
        documents.delete(sessionId)
      }
    })

    const snapshot = await invoke('GET', `/internal/yjs/sessions/layout-1/snapshot?${query}`)
    expect(snapshot.status).toBe(200)
    expect(documents.has('layout-1')).toBe(false)

    const client = new Y.Doc()
    Y.applyUpdate(client, Buffer.from(snapshot.body.snapshotBase64, 'base64'))
    client.getMap('layout').set('topology', {
      id: 'panel-after',
      type: 'panel',
      identityId: 'widget-after',
      widgetKey: null,
    })
    const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(client)).toString('base64')
    client.destroy()

    const response = await invoke('POST', `/internal/yjs/sessions/layout-1/apply-update?${query}`, {
      updateBase64,
    })
    expect(response).toMatchObject({
      status: 400,
      body: { error: 'Dashboard layout updates require the structural edit route' },
    })
    expect(mocks.commitDashboardStructure).not.toHaveBeenCalled()
  })

  it('lets a topology review commit after an independent widget changes', async () => {
    setDashboardDocuments({
      widget: createWidgetDoc('gray', { view: { interval: '1h' } }),
      blue: createPairDoc({ watchlistId: 'preserved-watchlist' }),
    })
    const entityDocument = JSON.stringify({
      layout: { id: 'panel-1', type: 'panel' },
    })
    const currentLayout = readDashboardLayoutDocument(documents.get('layout-1')!)
    const plan = applyLayoutEditDocument(currentLayout, entityDocument)
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardLayoutReviewBase(currentLayout, plan)
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'layout',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      entityDocument,
      removedPanelIds: [],
    })

    expect(response.status).toBe(200)
    expect(response.body.content.widgets['widget-1'].params.view.interval).toBe('1h')
    expect(response.body.content.colorPairs.pairs).toContainEqual({
      color: 'blue',
      watchlistId: 'preserved-watchlist',
    })
    expect(mocks.commitDashboardStructure).toHaveBeenCalledTimes(1)
    expect(mocks.saveDashboardWidget).not.toHaveBeenCalled()
    expect(mocks.saveDashboardPair).not.toHaveBeenCalled()
  })

  it('commits widget identity replacement through one structural transaction', async () => {
    setDashboardDocuments({
      widget: createWidgetDoc('gray', { view: { interval: '1h' } }),
      blue: createPairDoc({ watchlistId: 'preserved-watchlist' }),
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'replace', panelId: 'panel-1', widgetKey: 'watchlist' },
    })

    expect(response.status).toBe(200)
    const commit = mocks.commitDashboardStructure.mock.calls[0]?.[2]
    expect(commit).toMatchObject({
      createdWidgets: [
        {
          binding: { widgetKey: 'watchlist' },
          document: { pairColor: 'gray', params: null },
        },
      ],
      removedIdentityIds: ['widget-1'],
    })
    expect(mocks.beginDeletion).toHaveBeenCalledWith(['dashboard-widget:layout-1:widget-1'])
    expect(mocks.commitDeletion).toHaveBeenCalledWith('deletion-1')
    expect(mocks.saveDashboardPair).not.toHaveBeenCalled()
    expect(response.body.content.colorPairs.pairs).toContainEqual({
      color: 'blue',
      watchlistId: 'preserved-watchlist',
    })
  })

  it('copies the live source widget when splitting a panel', async () => {
    setDashboardDocuments({
      widget: createWidgetDoc('red', { view: { interval: '4h' } }),
      red: createPairDoc({ watchlistId: 'shared-watchlist' }),
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'split', panelId: 'panel-1', direction: 'horizontal' },
    })

    expect(response.status).toBe(200)
    expect(mocks.commitDashboardStructure.mock.calls[0]?.[2]).toMatchObject({
      createdWidgets: [
        {
          binding: { sourceIdentityId: 'widget-1', widgetKey: 'data_chart' },
          document: { pairColor: 'red', params: { view: { interval: '4h' } } },
        },
      ],
      removedIdentityIds: [],
    })
    expect(mocks.beginDeletion).not.toHaveBeenCalled()
  })

  it('applies a delayed resize to the live topology after a split', async () => {
    setDashboardDocuments({ widget: createWidgetDoc() })

    const split = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'split', panelId: 'panel-1', direction: 'horizontal' },
    })
    const groupId = split.body.content.layout.id

    const resize = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'resize', groupId, sizes: [35, 65] },
    })

    expect(resize.status).toBe(200)
    const commit = mocks.commitDashboardStructure.mock.calls[1]?.[2]
    expect(commit).toMatchObject({
      layout: { id: groupId, sizes: [35, 65] },
      createdWidgets: [],
      removedIdentityIds: [],
    })
    expect(commit.layout.children).toHaveLength(2)
    expect(mocks.saveDashboardPair).not.toHaveBeenCalled()
  })

  it('keeps live topology unchanged and aborts child deletion when structural persistence fails', async () => {
    setDashboardDocuments({ widget: createWidgetDoc() })
    const before = readDashboardLayoutDocument(documents.get('layout-1')!)
    mocks.commitDashboardStructure.mockRejectedValueOnce(new Error('database offline'))

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'replace', panelId: 'panel-1', widgetKey: 'watchlist' },
    })

    expect(response.status).toBe(500)
    expect(readDashboardLayoutDocument(documents.get('layout-1')!)).toEqual(before)
    expect(mocks.abortDeletion).toHaveBeenCalledWith('deletion-1')
    expect(mocks.commitDeletion).not.toHaveBeenCalled()
  })

  it('persists a local parameter edit only through the widget owner', async () => {
    setDashboardDocuments({
      widget: createWidgetDoc('gray', { view: { interval: '15m', candleType: 'candle_solid' } }),
    })
    const current = dashboardProjection()
    const patch = { params: { view: { interval: '1h' } } }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: current.widgets['widget-1'],
      colorPairs: current.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(current, 'panel-1', mutation.reviewBase, patch)
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response.status).toBe(200)
    expect(mocks.saveDashboardWidget).toHaveBeenCalledTimes(1)
    expect(mocks.saveDashboardWidget.mock.calls[0]?.[0]).toBe('dashboard-widget:layout-1:widget-1')
    expect(mocks.saveDashboardPair).not.toHaveBeenCalled()
    expect(response.body.content.widgets['widget-1'].params.view).toMatchObject({
      interval: '1h',
      candleType: 'candle_solid',
    })
  })

  it('persists a shared parameter edit only through the selected pair owner', async () => {
    const AAPL = {
      listing_type: 'default',
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
    }
    const NVDA = { ...AAPL, listing_id: 'NVDA' }
    setDashboardDocuments({
      widget: createWidgetDoc('red'),
      red: createPairDoc({ listing: AAPL }),
    })
    const current = dashboardProjection({ red: { listing: AAPL } })
    const patch = { colorPair: { listing: NVDA } }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: current.widgets['widget-1'],
      colorPairs: current.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(current, 'panel-1', mutation.reviewBase, patch)
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response.status).toBe(200)
    expect(mocks.saveDashboardPair).toHaveBeenCalledTimes(1)
    expect(mocks.saveDashboardPair.mock.calls[0]?.[0]).toBe('dashboard-color-pair:layout-1:red')
    expect(mocks.saveDashboardWidget).not.toHaveBeenCalled()
    expect(response.body.content.colorPairs.pairs[0].listing.listing_id).toBe('NVDA')
  })

  it('releases the exact widget and pair documents when child persistence flush fails', async () => {
    const listing = (listingId: string) => ({
      listing_type: 'default' as const,
      listing_id: listingId,
      base_id: '',
      quote_id: '',
    })
    const widgetDoc = createWidgetDoc('red')
    const pairDoc = createPairDoc({ listing: listing('AAPL') })
    setDashboardDocuments({ widget: widgetDoc, red: pairDoc })
    const layoutDoc = documents.get('layout-1')!
    const current = dashboardProjection({ red: { listing: listing('AAPL') } })
    const patch = { colorPair: { listing: listing('NVDA') } }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: current.widgets['widget-1'],
      colorPairs: current.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(current, 'panel-1', mutation.reviewBase, patch)
    )
    mocks.flushPersistence.mockImplementation(async (doc: Y.Doc) => {
      if (doc === pairDoc) throw new Error('database offline')
    })

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response).toMatchObject({ status: 500, body: { error: 'database offline' } })
    expect(mocks.discardIfIdle.mock.calls.slice(-3).map(([doc]) => doc)).toEqual([
      pairDoc,
      widgetDoc,
      layoutDoc,
    ])
  })

  it('validates the accepted widget review inside the widget mutation queue', async () => {
    const widgetDoc = createWidgetDoc('gray', { view: { interval: '15m' } })
    setDashboardDocuments({ widget: widgetDoc })
    const reviewed = dashboardProjection()
    const patch = { params: { view: { interval: '1h' } } }
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
    let injected = false
    mocks.runMutation.mockImplementation(
      async (doc: Y.Doc, queuedMutation: () => Promise<unknown> | unknown) => {
        if (doc === widgetDoc && !injected) {
          injected = true
          setDashboardWidgetDocument(doc, 'data_chart', {
            pairColor: 'gray',
            params: { view: { interval: '30m' } },
          })
        }
        return queuedMutation()
      }
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveDashboardWidget).not.toHaveBeenCalled()
  })

  it('keeps the live widget unchanged when its independent persistence fails', async () => {
    const widgetDoc = createWidgetDoc('gray', { view: { interval: '15m' } })
    setDashboardDocuments({ widget: widgetDoc })
    const current = dashboardProjection()
    const patch = { params: { view: { interval: '1h' } } }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: current.widgets['widget-1'],
      colorPairs: current.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(current, 'panel-1', mutation.reviewBase, patch)
    )
    mocks.saveDashboardWidget.mockRejectedValueOnce(new Error('database offline'))

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response).toMatchObject({ status: 500, body: { error: 'database offline' } })
    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').params).toEqual({
      view: { interval: '15m' },
    })
    expect(mocks.markPersisted).not.toHaveBeenCalled()
  })

  it('preserves the latest credential represented by a Copilot placeholder', async () => {
    const reviewedWidget = {
      pairColor: 'gray' as const,
      params: { data: { auth: { apiKey: 'reviewed-key', apiSecret: 'shared-secret' } } },
    }
    const liveWidget = createWidgetDoc('gray', {
      data: { auth: { apiKey: 'latest-key', apiSecret: 'shared-secret' } },
    })
    setDashboardDocuments({ widget: liveWidget })
    const reviewed = dashboardProjection({ widget: reviewedWidget })
    const patch = { params: { data: { auth: { apiKey: '[redacted]' } } } }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget: reviewedWidget,
      colorPairs: reviewed.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(reviewed, 'panel-1', mutation.reviewBase, patch)
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response.status).toBe(200)
    const staged = mocks.saveDashboardWidget.mock.calls[0]?.[1] as Y.Doc
    expect(
      (
        (readDashboardWidgetDocument(staged, 'data_chart').params?.data as Record<string, unknown>)
          .auth as Record<string, unknown>
      ).apiKey
    ).toBe('latest-key')
  })

  it('rejects pair rebinding when the destination pair changed after review', async () => {
    const listing = (listingId: string) => ({
      listing_type: 'default' as const,
      listing_id: listingId,
      base_id: '',
      quote_id: '',
    })
    const widget = { pairColor: 'red' as const, params: null }
    setDashboardDocuments({
      widget: createWidgetDoc('red'),
      red: createPairDoc({ listing: listing('AAPL') }),
      blue: createPairDoc({ listing: listing('GOOG') }),
    })
    const reviewed = dashboardProjection({
      widget,
      red: { listing: listing('AAPL') },
      blue: { listing: listing('MSFT') },
    })
    const patch = { pairColor: 'blue' }
    const mutation = applyWidgetConfigMutation({
      widgetKey: 'data_chart',
      widget,
      colorPairs: reviewed.colorPairs,
      panelId: 'panel-1',
      patch,
    })
    const expectedReviewBaseStateHash = hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(reviewed, 'panel-1', mutation.reviewBase, patch)
    )

    const response = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'widget',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      expectedReviewBaseStateHash,
      panelId: 'panel-1',
      patch,
    })

    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveDashboardWidget).not.toHaveBeenCalled()
    expect(mocks.saveDashboardPair).not.toHaveBeenCalled()
  })

  it('waits for orderly discard before acknowledging session deletion', async () => {
    let release!: () => void
    mocks.discard.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    let settled = false
    const responsePromise = invoke('DELETE', '/internal/yjs/sessions/layout-1').then((response) => {
      settled = true
      return response
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await expect(responsePromise).resolves.toEqual({
      status: 200,
      body: { success: true },
    })
  })

  it('coordinates exact-session deletion leases through begin, commit, and abort', async () => {
    mocks.beginDeletion.mockResolvedValueOnce('lease-1')
    const begun = await invoke('POST', '/internal/yjs/session-deletions', {
      sessionIds: ['layout-1', 'dashboard-widget:layout-1:widget-1'],
    })
    expect(begun).toEqual({ status: 200, body: { leaseId: 'lease-1' } })
    expect(mocks.beginDeletion).toHaveBeenCalledWith([
      'layout-1',
      'dashboard-widget:layout-1:widget-1',
    ])

    const committed = await invoke('POST', '/internal/yjs/session-deletions/lease-1/commit', {})
    expect(committed.status).toBe(200)
    expect(mocks.commitDeletion).toHaveBeenCalledWith('lease-1')

    const aborted = await invoke('DELETE', '/internal/yjs/session-deletions/lease-2')
    expect(aborted.status).toBe(200)
    expect(mocks.abortDeletion).toHaveBeenCalledWith('lease-2')
  })
})
