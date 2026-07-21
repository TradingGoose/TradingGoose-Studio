/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import {
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_RETRY_REQUIRED,
} from '@/lib/copilot/review-sessions/types'
import type { DocumentAdmission } from './upstream-utils'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const mockAuthenticateYjsConnection = vi.fn()
const mockInitializeSavedReviewTargetDocument = vi.fn()
const mockBindEntityListSession = vi.fn()
const mockAcquireDocument = vi.fn()
const mockAdmissionReadStore = { select: vi.fn() }
const mockDocuments = new Map<string, { doc: Y.Doc; seeded: boolean }>()
const mockSetupWSConnection = vi.fn()
const mockPersistStagedDocuments = vi.fn()
const mockSaveSavedEntityYjsDocToDb = vi.fn()
const mockRefreshActiveEntityListSession = vi.fn()
const mockUpgradedSocketClose = vi.fn()
const mockUpgradedSocketPause = vi.fn()
const mockUpgradedSocketResume = vi.fn()

class MockYjsAuthError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'YjsAuthError'
  }
}

class MockYjsSessionAdmissionError extends Error {
  constructor(_sessionId: string) {
    super('Yjs session is not accepting connections')
  }
}

type YjsTestTarget = {
  sessionId: string
  entityKind: string
  entityId?: string | null
  targetKind?: 'entity' | 'entity_list' | 'review_session'
  workspaceId?: string
  ownerUserId?: string | null
  reviewSessionId?: string | null
  draftSessionId?: string | null
}

function createYjsRequest(
  target: YjsTestTarget,
  accessMode: 'read' | 'write' = 'write'
): IncomingMessage {
  const targetKind = target.targetKind ?? 'entity'
  const entityId = target.entityId === undefined ? target.sessionId : target.entityId
  const params = new URLSearchParams({
    token: 'test-token',
    accessMode,
    targetKind,
    sessionId: target.sessionId,
    entityKind: target.entityKind,
  })
  if (entityId) params.set('entityId', entityId)
  if (target.workspaceId) params.set('workspaceId', target.workspaceId)
  if (target.ownerUserId) params.set('ownerUserId', target.ownerUserId)
  if (target.reviewSessionId) params.set('reviewSessionId', target.reviewSessionId)
  if (target.draftSessionId) params.set('draftSessionId', target.draftSessionId)
  return {
    url: `/yjs/${encodeURIComponent(target.sessionId)}?${params}`,
    headers: { host: 'localhost:3000' },
  } as IncomingMessage
}

function createSocket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Duplex
}

function createWebSocketServer() {
  const wss = new EventEmitter() as WebSocketServer & {
    handleUpgrade: ReturnType<typeof vi.fn>
  }

  wss.handleUpgrade = vi.fn((request, socket, head, callback) => {
    callback({
      close: mockUpgradedSocketClose,
      pause: mockUpgradedSocketPause,
      resume: mockUpgradedSocketResume,
    } as any)
  })

  return wss
}

async function loadModule() {
  return import('./ws-handler')
}

async function runYjsUpgrade(input: {
  target: YjsTestTarget
  accessMode?: 'read' | 'write'
  bootstrap?: { workspaceId?: string | null; state: Uint8Array } | null
}) {
  const accessMode = input.accessMode ?? 'write'
  const { target } = input
  const targetKind = target.targetKind ?? 'entity'
  const entityId = target.entityId === undefined ? target.sessionId : target.entityId
  const request = createYjsRequest(target, accessMode)
  const socket = createSocket()
  const wss = createWebSocketServer()
  const bootstrapUpdate = new Uint8Array([0, 0])
  mockAuthenticateYjsConnection.mockResolvedValue({
    userId: 'user-1',
    envelope: {
      targetKind,
      sessionId: target.sessionId,
      reviewSessionId: target.reviewSessionId ?? null,
      workspaceId: target.workspaceId ?? 'workspace-1',
      ownerUserId: target.ownerUserId ?? null,
      entityKind: target.entityKind,
      entityId,
      draftSessionId: target.draftSessionId ?? null,
    },
  })
  const bootstrap =
    input.bootstrap === undefined
      ? {
          workspaceId: target.workspaceId ?? 'workspace-1',
          state: bootstrapUpdate,
        }
      : input.bootstrap
  if (bootstrap)
    mockInitializeSavedReviewTargetDocument.mockResolvedValue({
      workspaceId: bootstrap.workspaceId ?? target.workspaceId ?? 'workspace-1',
      state: bootstrap.state,
    })
  else
    mockInitializeSavedReviewTargetDocument.mockRejectedValue(
      Object.assign(new Error('Review target is not bootstrapped'), { status: 404 })
    )

  const { handleYjsUpgrade } = await loadModule()
  handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
  await new Promise((resolve) => setImmediate(resolve))
  return { request, socket, wss }
}

beforeEach(() => {
  vi.resetModules()

  mockAuthenticateYjsConnection.mockReset()
  mockInitializeSavedReviewTargetDocument.mockReset()
  mockBindEntityListSession.mockClear()
  for (const { doc } of mockDocuments.values()) doc.destroy()
  mockDocuments.clear()
  mockAcquireDocument.mockReset().mockImplementation(
    async (
      sessionId: string,
      options: {
        admission?: DocumentAdmission
        initialize: (
          doc: Y.Doc,
          admission: DocumentAdmission | undefined,
          readStore: typeof mockAdmissionReadStore
        ) => Promise<{ state?: Uint8Array } | undefined> | { state?: Uint8Array } | undefined
      },
      use: (doc: Y.Doc, admission?: DocumentAdmission) => Promise<unknown> | unknown
    ) => {
      const admission = options.admission
      const entry = mockDocuments.get(sessionId) ?? { doc: new Y.Doc(), seeded: false }
      mockDocuments.set(sessionId, entry)
      if (!entry.seeded) {
        const initializedDocument = await options.initialize(
          entry.doc,
          admission,
          mockAdmissionReadStore
        )
        if (initializedDocument?.state) Y.applyUpdate(entry.doc, initializedDocument.state)
        entry.seeded = true
      }
      return use(entry.doc, admission)
    }
  )
  mockSetupWSConnection.mockReset()
  mockPersistStagedDocuments
    .mockReset()
    .mockImplementation(
      async (targets: Array<{ doc: Y.Doc }>, persist: (staged: Y.Doc[]) => Promise<unknown>) =>
        persist(targets.map(({ doc }) => doc))
    )
  mockSaveSavedEntityYjsDocToDb.mockReset()
  mockRefreshActiveEntityListSession.mockReset().mockResolvedValue(undefined)
  mockUpgradedSocketClose.mockReset()
  mockUpgradedSocketPause.mockReset()
  mockUpgradedSocketResume.mockReset()

  vi.doMock('@/lib/logs/console/logger', () => ({
    createLogger: vi.fn(() => mockLogger),
  }))

  vi.doMock('./auth', () => ({
    authenticateYjsConnection: mockAuthenticateYjsConnection,
    YjsAuthError: MockYjsAuthError,
  }))

  vi.doMock('@/lib/yjs/server/bootstrap-review-target', () => ({
    initializeSavedReviewTargetDocument: mockInitializeSavedReviewTargetDocument,
  }))

  vi.doMock('@/lib/yjs/server/revocation-fence', () => ({
    YjsSessionAdmissionError: MockYjsSessionAdmissionError,
  }))

  vi.doMock('./entity-list-session', () => ({
    bindEntityListSession: mockBindEntityListSession,
    refreshActiveEntityListSession: mockRefreshActiveEntityListSession,
  }))

  vi.doMock('@/lib/workflows/db-helpers', () => ({
    saveWorkflowYjsDocToDb: vi.fn(),
  }))

  vi.doMock('@/lib/yjs/server/apply-entity-state', () => ({
    saveSavedEntityYjsDocToDb: mockSaveSavedEntityYjsDocToDb,
  }))

  vi.doMock('./upstream-utils', () => ({
    acquireDocument: mockAcquireDocument,
    persistStagedDocuments: mockPersistStagedDocuments,
    setupWSConnection: mockSetupWSConnection,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('handleYjsUpgrade', () => {
  it('rejects an in-flight upgrade when shutdown begins during authentication', async () => {
    const sessionId = 'workflow-shutdown-race'
    const request = createYjsRequest({ sessionId, entityKind: 'workflow' })
    const socket = createSocket()
    const wss = createWebSocketServer()
    let resolveAuthentication!: (value: unknown) => void
    mockAuthenticateYjsConnection.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAuthentication = resolve
      })
    )
    let acceptsConnections = true

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0), () => acceptsConnections)
    acceptsConnections = false
    resolveAuthentication({
      userId: 'user-1',
      envelope: {
        targetKind: 'entity',
        sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
      },
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockUpgradedSocketClose).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_RETRY_REQUIRED,
      'Failed to attach Yjs session'
    )
  })

  it('rejects websocket upgrades when the Yjs auth token is invalid', async () => {
    const sessionId = 'workflow-invalid-token'
    const request = createYjsRequest({ sessionId, entityKind: 'workflow' })
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockRejectedValue(
      new MockYjsAuthError(401, 'Invalid or expired token')
    )

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockUpgradedSocketPause).toHaveBeenCalledOnce()
    expect(mockUpgradedSocketResume).not.toHaveBeenCalled()
    expect(mockUpgradedSocketClose).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_RETRY_REQUIRED,
      'Failed to attach Yjs session'
    )
  })

  it('allows dashboard widget write upgrades through canonical bootstrap', async () => {
    const sessionId = 'dashboard-widget:layout-1:widget-1'
    const { request } = await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_widget',
        entityId: 'widget-1',
        ownerUserId: 'user-1',
      },
      accessMode: 'write',
    })

    expect(mockInitializeSavedReviewTargetDocument).toHaveBeenCalledWith(
      expect.objectContaining({ entityKind: 'dashboard_widget', entityId: 'widget-1' }),
      mockAdmissionReadStore
    )
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        doc: expect.any(Y.Doc),
        accessMode: 'write',
        onDocumentUpdate: expect.any(Function),
      })
    )
    expect(mockUpgradedSocketPause.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthenticateYjsConnection.mock.invocationCallOrder[0]!
    )
    expect(mockSetupWSConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpgradedSocketResume.mock.invocationCallOrder[0]!
    )
  })

  it.each([
    ['saved entity', { sessionId: 'watchlist-read', entityKind: 'watchlist' }],
    [
      'dashboard layout',
      {
        sessionId: 'layout-read',
        entityKind: 'dashboard_layout',
        ownerUserId: 'user-1',
      },
    ],
  ])('allows %s read-mode websocket upgrades', async (_label, target) => {
    const { request, wss } = await runYjsUpgrade({ target, accessMode: 'read' })

    expect(wss.handleUpgrade).toHaveBeenCalledOnce()
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        doc: expect.any(Y.Doc),
        accessMode: 'read',
        onDocumentUpdate: undefined,
      })
    )
  })

  it('binds an entity-list reconciler during document initialization', async () => {
    const sessionId = 'list:watchlist:workspace-1'
    const listDoc = new Y.Doc()
    mockDocuments.set(sessionId, { doc: listDoc, seeded: false })
    try {
      await runYjsUpgrade({
        target: { sessionId, entityKind: 'watchlist', entityId: null, targetKind: 'entity_list' },
        accessMode: 'read',
      })

      expect(mockBindEntityListSession).toHaveBeenCalledWith(
        listDoc,
        'watchlist',
        'workspace-1',
        null
      )
      expect(mockInitializeSavedReviewTargetDocument).not.toHaveBeenCalled()
    } finally {
      listDoc.destroy()
    }
  })

  it('persists writable watchlist updates through the saved-document lifecycle', async () => {
    const sessionId = 'watchlist-write'
    await runYjsUpgrade({ target: { sessionId, entityKind: 'watchlist' } })

    const options = mockSetupWSConnection.mock.calls[0]?.[2]
    expect(options).toEqual(
      expect.objectContaining({
        doc: expect.any(Y.Doc),
        onDocumentUpdate: expect.any(Function),
      })
    )
    const doc = new Y.Doc()
    const metadata = doc.getMap('metadata')
    metadata.set('entityKind', 'skill')
    metadata.set('entityId', 'client-controlled-entity')
    metadata.set('workspaceId', 'client-controlled-workspace')
    metadata.set('draftSessionId', 'client-controlled-draft')
    metadata.set('reviewSessionId', null)
    await options.onDocumentUpdate(sessionId, doc)

    expect(mockSaveSavedEntityYjsDocToDb).toHaveBeenCalledWith(
      'watchlist',
      sessionId,
      'workspace-1',
      doc
    )
    expect(mockRefreshActiveEntityListSession).toHaveBeenCalledWith('watchlist', 'workspace-1')
    doc.destroy()
  })

  it('persists manual saved-entity updates through the websocket lifecycle', async () => {
    const sessionId = 'skill-write'
    await runYjsUpgrade({ target: { sessionId, entityKind: 'skill' } })

    const options = mockSetupWSConnection.mock.calls[0]?.[2]
    expect(options).toEqual(
      expect.objectContaining({
        doc: expect.any(Y.Doc),
        persist: expect.any(Function),
        onDocumentUpdate: undefined,
      })
    )
    const doc = new Y.Doc()
    await options.persist(doc, 'request-1', 'Renamed skill')

    expect(mockPersistStagedDocuments).toHaveBeenCalledWith(
      [{ doc }],
      expect.any(Function),
      'request-1'
    )
    expect(mockSaveSavedEntityYjsDocToDb).toHaveBeenCalledWith(
      'skill',
      sessionId,
      'workspace-1',
      doc,
      { identity: { name: 'Renamed skill' } }
    )
    expect(mockRefreshActiveEntityListSession).toHaveBeenCalledWith('skill', 'workspace-1')
    doc.destroy()
  })

  it('rejects writable dashboard layout websocket upgrades', async () => {
    const sessionId = 'layout-write'
    await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_layout',
        ownerUserId: 'user-1',
      },
    })

    expect(mockSetupWSConnection).not.toHaveBeenCalled()
    expect(mockUpgradedSocketClose).toHaveBeenCalledWith(4403, 'Failed to attach Yjs session')
  })

  it.each([
    [YJS_CLOSE_CODE_AUTHORIZATION_REVOKED, new MockYjsAuthError(403, 'Forbidden')],
    [YJS_CLOSE_CODE_RETRY_REQUIRED, new MockYjsSessionAdmissionError('watchlist-fenced')],
  ])('maps an acquisition failure to close code %i', async (closeCode, error) => {
    mockAcquireDocument.mockRejectedValueOnce(error)

    await runYjsUpgrade({
      target: { sessionId: 'watchlist-fenced', entityKind: 'watchlist' },
    })

    expect(mockUpgradedSocketClose).toHaveBeenCalledWith(closeCode, 'Failed to attach Yjs session')
  })

  it('rejects websocket upgrades for missing non-entity review sessions', async () => {
    const sessionId = 'review-unbootstrapped'
    await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'skill',
        entityId: null,
        targetKind: 'review_session',
        workspaceId: 'workspace-3',
        reviewSessionId: sessionId,
        draftSessionId: 'draft-1',
      },
      bootstrap: null,
    })

    expect(mockUpgradedSocketClose).toHaveBeenCalledWith(4410, 'Failed to attach Yjs session')
  })
})
