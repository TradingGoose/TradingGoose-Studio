import type { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
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
  applyDashboardWidgetDocumentDelta,
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import { SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import { ReviewTargetBootstrapError } from '@/lib/yjs/server/bootstrap-review-target'
import {
  applyLayoutEditDocument,
  type DashboardLayoutProjectionContent,
} from '@/widgets/layout-document'
import { applyWidgetConfigMutation } from '@/widgets/widget-mutations'
import { createHttpHandler } from './http'

const mocks = vi.hoisted(() => ({
  saveDashboard: vi.fn(),
  saveEntity: vi.fn(),
  initializeTarget: vi.fn(),
  getRuntime: vi.fn(() => ({ docState: 'active' })),
  refreshActiveEntityList: vi.fn(),
  acquireDocument: vi.fn(),
  persistStaged: vi.fn(),
  seedEntity: vi.fn(),
  getEntityFields: vi.fn(),
  commitDashboardStructure: vi.fn(),
  drainTargets: vi.fn(),
  runRevocation: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'internal-secret' } }))
vi.mock('@/lib/workflows/db-helpers', () => ({ saveWorkflowYjsDocToDb: vi.fn() }))
vi.mock('@/lib/yjs/workflow-session', () => ({ replaceWorkflowDocumentState: vi.fn() }))
vi.mock('@/lib/yjs/workflow-variables', () => ({ replaceWorkflowVariables: vi.fn() }))
vi.mock('@/socket-server/monitor-runtime-lock', () => ({
  getMonitorRuntimeLockHealth: () => ({ degraded: false }),
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  saveDashboardYjsDocsToDb: mocks.saveDashboard,
  saveSavedEntityYjsDocToDb: mocks.saveEntity,
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', async (importOriginal) => ({
  ...(await importOriginal()),
  initializeSavedReviewTargetDocument: mocks.initializeTarget,
}))

vi.mock('@/lib/yjs/server/revocation-fence', () => ({
  runYjsRevocationTransaction: mocks.runRevocation,
  YjsSessionAdmissionError: class YjsSessionAdmissionError extends Error {
    status = 409
  },
}))

vi.mock('@/socket-server/yjs/entity-list-session', () => ({
  refreshActiveEntityListSession: mocks.refreshActiveEntityList,
}))

vi.mock('@/lib/copilot/review-sessions/runtime', () => ({
  getReviewTargetRuntimeState: mocks.getRuntime,
}))

vi.mock('@/socket-server/yjs/upstream-utils', () => ({
  acquireDocument: mocks.acquireDocument,
  drainYjsSessionTargets: mocks.drainTargets,
  persistStagedDocuments: mocks.persistStaged,
}))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  DashboardLayoutOperationError: class DashboardLayoutOperationError extends Error {},
  commitDashboardLayoutStructure: mocks.commitDashboardStructure,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  seedEntitySession: mocks.seedEntity,
  getEntityFields: mocks.getEntityFields,
}))

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
let documents = new Map<string, Y.Doc>()
let activeAcquisitions = new Set<string>()

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

const listing = (listingId: string) => ({
  listing_type: 'default' as const,
  listing_id: listingId,
  base_id: '',
  quote_id: '',
})

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
  return { state: Y.encodeStateAsUpdate(doc) }
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

function widgetReviewHash(
  current: DashboardLayoutProjectionContent,
  patch: Parameters<typeof applyWidgetConfigMutation>[0]['patch']
) {
  const mutation = applyWidgetConfigMutation({
    origin: 'copilot',
    widgetKey: 'data_chart',
    widget: current.widgets['widget-1'],
    colorPairs: current.colorPairs,
    panelId: 'panel-1',
    patch,
  })
  return hashServerToolReviewBase(
    buildDashboardWidgetReviewBase(current, 'panel-1', mutation.reviewBase, patch)
  )
}

const invokeWidgetEdit = (
  patch: Parameters<typeof applyWidgetConfigMutation>[0]['patch'],
  expectedReviewBaseStateHash: string,
  panelId = 'panel-1'
) =>
  invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
    mutation: 'widget',
    workspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    expectedReviewBaseStateHash,
    panelId,
    patch,
  })

describe('socket internal HTTP Yjs routes', () => {
  beforeEach(() => {
    for (const doc of documents.values()) doc.destroy()
    documents = new Map()
    activeAcquisitions = new Set()
    vi.clearAllMocks()
    mocks.refreshActiveEntityList.mockResolvedValue(null)
    mocks.persistStaged.mockImplementation(
      async (
        targets: Array<{ doc: Y.Doc; mutate?: (staged: Y.Doc) => void }>,
        persist: (staged: Y.Doc[]) => Promise<unknown>
      ) => {
        const liveStates = targets.map(({ doc }) => Y.encodeStateVector(doc))
        const staging = targets.map(({ doc }) => {
          const staged = new Y.Doc()
          Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc))
          return staged
        })
        try {
          targets.forEach(({ mutate }, index) => mutate?.(staging[index]!))
          const result = await persist(staging)
          targets.forEach(({ doc }, index) =>
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(staging[index]!, liveStates[index]))
          )
          return result
        } finally {
          staging.forEach((doc) => doc.destroy())
        }
      }
    )
    mocks.saveDashboard.mockResolvedValue({})
    mocks.drainTargets.mockResolvedValue(undefined)
    mocks.runRevocation.mockImplementation(
      async (_target: unknown, _drain: unknown, mutation: () => Promise<unknown>) => mutation()
    )
    mocks.commitDashboardStructure.mockImplementation(
      async (_scope: unknown, _layoutId: string, commit: { layout: unknown }) => ({
        layout: commit.layout,
      })
    )
    mocks.saveEntity.mockImplementation(
      async (_kind: string, _id: string, _workspaceId: string, doc: Y.Doc) =>
        doc.getMap('test').get('fields')
    )
    mocks.acquireDocument.mockImplementation(
      async (
        sessionId: string,
        options: {
          initialize: (
            doc: Y.Doc
          ) => Promise<{ state?: Uint8Array } | undefined> | { state?: Uint8Array } | undefined
        },
        use: (doc: Y.Doc) => Promise<unknown> | unknown
      ) => {
        if (activeAcquisitions.has(sessionId)) {
          throw new Error(`Nested document acquisition: ${sessionId}`)
        }
        activeAcquisitions.add(sessionId)
        let doc = documents.get(sessionId)
        const created = !doc
        try {
          if (!doc) {
            doc = new Y.Doc()
            documents.set(sessionId, doc)
            const initializedDocument = await options.initialize(doc)
            if (initializedDocument?.state) Y.applyUpdate(doc, initializedDocument.state)
          }
          return await use(doc)
        } finally {
          activeAcquisitions.delete(sessionId)
          if (created) documents.delete(sessionId)
        }
      }
    )
    mocks.initializeTarget.mockImplementation(async (descriptor: { entityKind: string }) => {
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

  it('preserves saved-entity owner error details', async () => {
    mocks.initializeTarget.mockRejectedValueOnce(
      new ReviewTargetBootstrapError(410, 'Review target expired')
    )

    await expect(
      invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
        entityKind: 'skill',
        workspaceId: 'workspace-1',
        fields: { description: 'Skill', content: 'Content' },
      })
    ).resolves.toMatchObject({ status: 410, body: { error: 'Review target expired' } })
    mocks.saveEntity.mockRejectedValueOnce(new SavedEntityRealtimeRequiredError())

    await expect(
      invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
        entityKind: 'skill',
        workspaceId: 'workspace-1',
        fields: { description: 'Skill', content: 'Content' },
      })
    ).resolves.toMatchObject({
      status: 503,
      body: { code: 'SAVED_ENTITY_REALTIME_REQUIRED', retryable: true },
    })
  })

  it('binds workflow snapshots and live applies through canonical document acquisition', async () => {
    const descriptor = buildSavedEntityDescriptor('workflow', 'workflow-1', null)
    const source = new Y.Doc()
    const bootstrap = snapshotOf(source)
    source.destroy()
    mocks.initializeTarget.mockResolvedValue(bootstrap)
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()

    const snapshot = await invoke('GET', `/internal/yjs/sessions/workflow-1/snapshot?${query}`)
    expect(snapshot.body.descriptor).toEqual(descriptor)
    expect(mocks.acquireDocument).toHaveBeenCalledOnce()

    mocks.acquireDocument.mockClear()
    mocks.initializeTarget.mockClear()
    await expect(
      invoke('POST', '/internal/yjs/workflows/workflow-1/apply-state', { variables: {} })
    ).resolves.toMatchObject({ status: 200 })
    expect(mocks.initializeTarget).toHaveBeenCalledWith(descriptor)
    expect(mocks.acquireDocument).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({ initialize: expect.any(Function), workspaceId: null }),
      expect.any(Function)
    )
  })

  it('checks accepted entity review hashes inside the queued mutation', async () => {
    const doc = new Y.Doc()
    doc.getMap('test').set('fields', { description: 'Changed', content: 'Current' })
    documents.set('skill-1', doc)

    const response = await invoke('POST', '/internal/yjs/entities/skill-1/apply-state', {
      entityKind: 'skill',
      workspaceId: 'workspace-1',
      fields: { description: 'Reviewed', content: 'Next' },
      expectedReviewBaseStateHash: 'stale-review-hash',
    })
    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveEntity).not.toHaveBeenCalled()
  })

  it('keeps snapshot-only layout state detached', async () => {
    const descriptor = buildSavedEntityDescriptor('dashboard_layout', 'layout-1', 'workspace-1', {
      ownerUserId: 'user-1',
    })
    const query = new URLSearchParams(
      serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
    ).toString()
    mocks.initializeTarget.mockImplementation(async (target: { entityKind: string }) => {
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
    const snapshot = await invoke('GET', `/internal/yjs/sessions/layout-1/snapshot?${query}`)
    expect(snapshot.status).toBe(200)
    expect(documents.has('layout-1')).toBe(false)
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
    expect(mocks.saveDashboard).not.toHaveBeenCalled()
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
    expect(mocks.runRevocation).toHaveBeenCalledWith(
      {
        sessionIds: ['dashboard-widget:layout-1:widget-1'],
      },
      mocks.drainTargets,
      expect.any(Function)
    )
    expect(mocks.saveDashboard).not.toHaveBeenCalled()
    expect(response.body).toEqual({ success: true })
    expect(mocks.acquireDocument.mock.calls.map(([sessionId]) => sessionId)).toEqual(['layout-1'])
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
    expect(mocks.runRevocation).not.toHaveBeenCalled()
    expect(mocks.acquireDocument.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      'layout-1',
      'dashboard-widget:layout-1:widget-1',
    ])
  })

  it('applies a completed resize to the live topology after a split', async () => {
    setDashboardDocuments({ widget: createWidgetDoc() })

    const split = await invoke('POST', '/internal/yjs/dashboard-layouts/layout-1/edit', {
      mutation: 'structure',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      structure: { type: 'split', panelId: 'panel-1', direction: 'horizontal' },
    })
    expect(split.status).toBe(200)
    const groupId = readDashboardLayoutDocument(documents.get('layout-1')!).layout.id
    mocks.acquireDocument.mockClear()

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
    expect(mocks.saveDashboard).not.toHaveBeenCalled()
    expect(mocks.acquireDocument.mock.calls.map(([sessionId]) => sessionId)).toEqual(['layout-1'])
  })

  it('keeps live topology unchanged when protected structural persistence fails', async () => {
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
    expect(mocks.runRevocation).toHaveBeenCalledWith(
      { sessionIds: ['dashboard-widget:layout-1:widget-1'] },
      mocks.drainTargets,
      expect.any(Function)
    )
  })

  it('persists a local parameter edit only through the widget owner', async () => {
    setDashboardDocuments({
      widget: createWidgetDoc('gray', { view: { interval: '15m', candleType: 'candle_solid' } }),
    })
    const current = dashboardProjection()
    const patch = { params: { view: { interval: '1h' } } }
    const expectedReviewBaseStateHash = widgetReviewHash(current, patch)

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response.status).toBe(200)
    expect(mocks.saveDashboard).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      {
        widget: {
          sessionId: 'dashboard-widget:layout-1:widget-1',
          doc: expect.any(Y.Doc),
        },
      }
    )
    expect(response.body.content.widgets['widget-1'].params.view).toMatchObject({
      interval: '1h',
      candleType: 'candle_solid',
    })
  })

  it('returns structured retryable widget validation and stale-target errors', async () => {
    setDashboardDocuments({ widget: createWidgetDoc() })
    const invalid = await invokeWidgetEdit(
      { params: { view: { pineIndicators: 123 } } },
      'unused-review-hash'
    )
    expect(invalid).toMatchObject({
      status: 422,
      body: {
        code: 'invalid_widget_config',
        retryable: true,
        issues: [{ path: 'params.view.pineIndicators' }],
      },
    })

    const stale = await invokeWidgetEdit({}, 'unused-review-hash', 'missing-panel')
    expect(stale).toMatchObject({
      status: 422,
      body: { code: 'invalid_widget_target', issues: [{ path: 'panelId' }] },
    })
  })

  it('persists a shared parameter edit only through the selected pair owner', async () => {
    const AAPL = listing('AAPL')
    const NVDA = { ...AAPL, listing_id: 'NVDA' }
    setDashboardDocuments({
      widget: createWidgetDoc('red'),
      red: createPairDoc({ listing: AAPL }),
    })
    const current = dashboardProjection({ red: { listing: AAPL } })
    const patch = { colorPair: { listing: NVDA } }
    const expectedReviewBaseStateHash = widgetReviewHash(current, patch)

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response.status).toBe(200)
    expect(mocks.saveDashboard).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      {
        colorPair: {
          sessionId: 'dashboard-color-pair:layout-1:red',
          doc: expect.any(Y.Doc),
        },
      }
    )
    expect(response.body.content.colorPairs.pairs[0].listing.listing_id).toBe('NVDA')
  })

  it('commits mixed widget and color-pair edits atomically before updating either live owner', async () => {
    const widgetDoc = createWidgetDoc('red', { view: { interval: '15m' } })
    const pairDoc = createPairDoc({ listing: listing('AAPL') })
    setDashboardDocuments({ widget: widgetDoc, red: pairDoc })
    const current = dashboardProjection({ red: { listing: listing('AAPL') } })
    const patch = {
      params: { view: { interval: '1h' } },
      colorPair: { listing: listing('NVDA') },
    }
    const expectedReviewBaseStateHash = widgetReviewHash(current, patch)
    const beforeWidget = readDashboardWidgetDocument(widgetDoc, 'data_chart')
    const beforePair = readDashboardColorPairDocument(pairDoc)
    mocks.saveDashboard.mockRejectedValueOnce(new Error('database offline'))

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response).toMatchObject({ status: 500, body: { error: 'database offline' } })
    expect(mocks.saveDashboard).toHaveBeenCalledOnce()
    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart')).toEqual(beforeWidget)
    expect(readDashboardColorPairDocument(pairDoc)).toEqual(beforePair)
    expect(mocks.persistStaged).toHaveBeenCalledOnce()
  })

  it('validates the accepted widget review inside the widget mutation queue', async () => {
    const widgetDoc = createWidgetDoc('gray', { view: { interval: '15m' } })
    setDashboardDocuments({ widget: widgetDoc })
    const reviewed = dashboardProjection()
    const patch = { params: { view: { interval: '1h' } } }
    const expectedReviewBaseStateHash = widgetReviewHash(reviewed, patch)
    let injected = false
    const acquire = mocks.acquireDocument.getMockImplementation()!
    mocks.acquireDocument.mockImplementation((...args: Parameters<typeof acquire>) => {
      if (args[0] === 'dashboard-widget:layout-1:widget-1' && !injected) {
        injected = true
        const before = readDashboardWidgetDocument(widgetDoc, 'data_chart')
        applyDashboardWidgetDocumentDelta(widgetDoc, 'data_chart', before, {
          pairColor: 'gray',
          params: { view: { interval: '30m' } },
        })
      }
      return acquire(...args)
    })

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveDashboard).not.toHaveBeenCalled()
  })

  it('commits credential preserve, replace, and delete semantics by stable array id', async () => {
    const reviewedWidget = {
      pairColor: 'gray' as const,
      params: {
        view: {
          pineIndicators: [
            {
              id: 'indicator-a',
              inputs: { apiKey: 'reviewed-a', apiSecret: 'reviewed-secret-a' },
            },
            { id: 'indicator-b', inputs: { apiKey: 'reviewed-b' } },
          ],
        },
      },
    }
    const liveWidget = createWidgetDoc('gray', {
      view: {
        pineIndicators: [
          {
            id: 'indicator-a',
            inputs: { apiKey: 'reviewed-a', apiSecret: 'reviewed-secret-a' },
          },
          { id: 'indicator-b', inputs: { apiKey: 'latest-b' } },
        ],
      },
    })
    setDashboardDocuments({ widget: liveWidget })
    const reviewed = dashboardProjection({ widget: reviewedWidget })
    const patch = {
      params: {
        view: {
          pineIndicators: [
            { id: 'indicator-b', inputs: { apiKey: '[redacted]' } },
            { id: 'indicator-a', inputs: { apiKey: 'replacement-a' } },
          ],
        },
      },
    }
    const expectedReviewBaseStateHash = widgetReviewHash(reviewed, patch)
    let savedWidget: ReturnType<typeof readDashboardWidgetDocument> | undefined
    mocks.saveDashboard.mockImplementationOnce(async (_scope, parts) => {
      savedWidget = readDashboardWidgetDocument(parts.widget.doc, 'data_chart')
      return { widget: savedWidget }
    })

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response.status).toBe(200)
    expect(savedWidget?.params?.view).toEqual({
      pineIndicators: [
        { id: 'indicator-b', inputs: { apiKey: 'latest-b' } },
        { id: 'indicator-a', inputs: { apiKey: 'replacement-a' } },
      ],
    })
  })

  it('rejects pair rebinding when the destination pair changed after review', async () => {
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
    const expectedReviewBaseStateHash = widgetReviewHash(reviewed, patch)

    const response = await invokeWidgetEdit(patch, expectedReviewBaseStateHash)

    expect(response).toMatchObject({
      status: 409,
      body: { code: 'stale_server_tool_review' },
    })
    expect(mocks.saveDashboard).not.toHaveBeenCalled()
  })

  it('delegates idempotent target drains and leaves removed lease routes absent', async () => {
    const drained = await invoke('POST', '/internal/yjs/session-drains', {
      sessionIds: ['layout-1', 'dashboard-widget:layout-1:widget-1'],
      workspaceIds: ['workspace-1'],
    })
    expect(drained).toEqual({ status: 200, body: { success: true } })
    expect(mocks.drainTargets).toHaveBeenCalledWith({
      sessionIds: ['layout-1', 'dashboard-widget:layout-1:widget-1'],
      workspaceIds: ['workspace-1'],
    })

    const invalid = await invoke('POST', '/internal/yjs/session-drains', {
      sessionIds: 'bad',
    })
    expect(invalid.status).toBe(400)

    const committed = await invoke('POST', '/internal/yjs/session-drains/lease-1/commit')
    expect(committed.status).toBe(404)

    const aborted = await invoke('DELETE', '/internal/yjs/session-drains/lease-2')
    expect(aborted.status).toBe(404)
  })
})
