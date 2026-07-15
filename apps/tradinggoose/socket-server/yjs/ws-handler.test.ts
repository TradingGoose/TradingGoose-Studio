/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { seedDashboardWidgetSession } from '@/lib/yjs/dashboard-layout-session'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const mockAuthenticateYjsConnection = vi.fn()
const mockCreateSavedReviewTargetBootstrapUpdate = vi.fn()
const mockReconcileEntityListSession = vi.fn()
const mockVerifyReviewTargetAccess = vi.fn()
const mockDiscardDocumentIfIdle = vi.fn()
const mockGetDocument = vi.fn()
const mockGetExistingDocument = vi.fn()
const mockSetupWSConnection = vi.fn()
const mockReadPersistedDashboardWidgetBinding = vi.fn()
const mockSaveSavedEntityYjsDocToDb = vi.fn()
const mockRefreshEntityListSession = vi.fn()

class MockYjsAuthError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
    this.name = 'YjsAuthError'
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
    callback({} as any)
  })

  return wss
}

async function loadModule() {
  return import('./ws-handler')
}

async function runYjsUpgrade(input: {
  target: YjsTestTarget
  accessMode?: 'read' | 'write'
  access?: { hasAccess: boolean; userPermission?: 'read' | 'write'; workspaceId?: string }
  bootstrap?: { runtime: { docState: string }; state: Uint8Array } | null
}) {
  const accessMode = input.accessMode ?? 'write'
  const { target } = input
  const targetKind = target.targetKind ?? 'entity'
  const entityId = target.entityId === undefined ? target.sessionId : target.entityId
  const request = createYjsRequest(target, accessMode)
  const socket = createSocket()
  const wss = createWebSocketServer()
  const bootstrapState = new Uint8Array([0, 0])
  mockAuthenticateYjsConnection.mockResolvedValue({
    userId: 'user-1',
    userName: 'User One',
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
  mockVerifyReviewTargetAccess.mockResolvedValue(
    input.access ?? {
      hasAccess: true,
      userPermission: accessMode,
      workspaceId: target.workspaceId ?? 'workspace-1',
    }
  )
  mockGetExistingDocument.mockResolvedValue(null)
  const bootstrap =
    input.bootstrap === undefined
      ? {
          runtime: { docState: 'active', replaySafe: true, reseededFromCanonical: true },
          state: bootstrapState,
        }
      : input.bootstrap
  if (bootstrap) mockCreateSavedReviewTargetBootstrapUpdate.mockResolvedValue(bootstrap)

  const { handleYjsUpgrade } = await loadModule()
  handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
  await new Promise((resolve) => setImmediate(resolve))
  return { bootstrapState, request, socket, wss }
}

beforeEach(() => {
  vi.resetModules()

  mockAuthenticateYjsConnection.mockReset()
  mockCreateSavedReviewTargetBootstrapUpdate.mockReset()
  mockReconcileEntityListSession.mockReset()
  mockVerifyReviewTargetAccess.mockReset()
  mockDiscardDocumentIfIdle.mockReset()
  mockGetDocument.mockReset()
  mockGetExistingDocument.mockReset()
  mockSetupWSConnection.mockReset()
  mockReadPersistedDashboardWidgetBinding.mockReset()
  mockSaveSavedEntityYjsDocToDb.mockReset()
  mockRefreshEntityListSession.mockReset().mockResolvedValue(undefined)

  vi.doMock('@/lib/logs/console/logger', () => ({
    createLogger: vi.fn(() => mockLogger),
  }))

  vi.doMock('./auth', () => ({
    authenticateYjsConnection: mockAuthenticateYjsConnection,
    YjsAuthError: MockYjsAuthError,
  }))

  vi.doMock('@/lib/copilot/review-sessions/permissions', () => ({
    verifyReviewTargetAccess: mockVerifyReviewTargetAccess,
  }))

  vi.doMock('@/lib/yjs/server/bootstrap-review-target', () => ({
    createSavedReviewTargetBootstrapUpdate: mockCreateSavedReviewTargetBootstrapUpdate,
  }))

  vi.doMock('./entity-list-session', () => ({
    reconcileEntityListSession: mockReconcileEntityListSession,
  }))

  vi.doMock('@/lib/dashboard-layouts/operations', () => ({
    readPersistedDashboardWidgetBinding: mockReadPersistedDashboardWidgetBinding,
  }))

  vi.doMock('@/lib/workflows/db-helpers', () => ({
    saveWorkflowYjsDocToDb: vi.fn(),
  }))

  vi.doMock('@/lib/yjs/server/apply-entity-state', () => ({
    saveSavedEntityYjsDocToDb: mockSaveSavedEntityYjsDocToDb,
  }))

  vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
    refreshEntityListSession: mockRefreshEntityListSession,
  }))

  vi.doMock('./upstream-utils', () => ({
    discardDocumentIfIdle: mockDiscardDocumentIfIdle,
    getDocument: mockGetDocument,
    getExistingDocument: mockGetExistingDocument,
    isYjsSessionAdmissionBlocked: vi.fn(() => false),
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
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'write',
      workspaceId: 'workspace-1',
      isOwner: false,
    })
    const liveDoc = new Y.Doc()
    mockGetExistingDocument.mockResolvedValue(liveDoc)
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

    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('409'))
    expect(socket.destroy).toHaveBeenCalledOnce()
    liveDoc.destroy()
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

    expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('401 Invalid or expired token')
    )
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('rejects websocket upgrades for read-only access', async () => {
    const sessionId = 'workflow-123'
    const { socket, wss } = await runYjsUpgrade({
      target: { sessionId, entityKind: 'workflow' },
      access: {
        hasAccess: false,
        userPermission: 'write',
        workspaceId: 'workspace-1',
      },
    })

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('write')
    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'))
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('allows dashboard widget write upgrades with canonical validation', async () => {
    const sessionId = 'dashboard-widget:layout-1:widget-1'
    mockReadPersistedDashboardWidgetBinding.mockResolvedValue({
      widgetKey: 'data_chart',
      document: { pairColor: 'gray', params: null },
    })
    const { bootstrapState, request, socket, wss } = await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_widget',
        entityId: 'widget-1',
        ownerUserId: 'user-1',
      },
      accessMode: 'write',
    })

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('write')
    expect(mockCreateSavedReviewTargetBootstrapUpdate).toHaveBeenCalled()
    expect(mockReadPersistedDashboardWidgetBinding).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      'widget-1'
    )
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        bootstrapState,
        docId: sessionId,
        accessMode: 'write',
        gc: true,
        onDocumentUpdate: expect.any(Function),
        validateDocument: expect.any(Function),
      })
    )
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()

    const validateDocument = mockSetupWSConnection.mock.calls[0]?.[2]?.validateDocument
    const invalidWidget = new Y.Doc()
    try {
      seedDashboardWidgetSession(invalidWidget, {
        pairColor: 'gray',
        params: { watchlistId: 'watchlist-1' },
      })
      expect(() => validateDocument(invalidWidget)).toThrow(/does not support this field/i)
    } finally {
      invalidWidget.destroy()
    }
  })

  it('allows saved entity read-mode websocket upgrades after target authorization', async () => {
    const sessionId = 'watchlist-read'
    const { request, wss } = await runYjsUpgrade({
      target: { sessionId, entityKind: 'watchlist' },
      accessMode: 'read',
    })

    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('read')
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        docId: sessionId,
        accessMode: 'read',
        onDocumentUpdate: undefined,
      })
    )
  })

  it('reconciles an entity list through its live document before attaching a reader', async () => {
    const sessionId = 'list:skill:workspace-1'
    const listDoc = new Y.Doc()
    mockGetDocument.mockReturnValue({ doc: listDoc, created: true })
    mockReconcileEntityListSession.mockRejectedValueOnce(new Error('database offline'))
    try {
      const failed = await runYjsUpgrade({
        target: { sessionId, entityKind: 'skill', entityId: null, targetKind: 'entity_list' },
        accessMode: 'read',
      })
      expect(failed.wss.handleUpgrade).not.toHaveBeenCalled()

      const { request, wss } = await runYjsUpgrade({
        target: { sessionId, entityKind: 'skill', entityId: null, targetKind: 'entity_list' },
        accessMode: 'read',
      })

      expect(mockReconcileEntityListSession).toHaveBeenCalledWith(
        listDoc,
        'skill',
        'workspace-1',
        null
      )
      expect(mockCreateSavedReviewTargetBootstrapUpdate).not.toHaveBeenCalled()
      expect(wss.handleUpgrade).toHaveBeenCalledWith(
        request,
        expect.anything(),
        expect.anything(),
        expect.any(Function)
      )
    } finally {
      listDoc.destroy()
    }
  })

  it('binds strict color-pair validation during authenticated setup', async () => {
    const sessionId = 'dashboard-color-pair:layout-1:red'
    const { request } = await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_color_pair',
        entityId: 'red',
        ownerUserId: 'user-1',
      },
      accessMode: 'write',
    })

    expect(mockReadPersistedDashboardWidgetBinding).not.toHaveBeenCalled()
    const validateDocument = mockSetupWSConnection.mock.calls[0]?.[2]?.validateDocument
    const invalidPair = new Y.Doc()
    try {
      invalidPair.getMap('colorPair').set('unsupported', true)
      expect(() => validateDocument(invalidPair)).toThrow(/canonical shared fields/i)
    } finally {
      invalidPair.destroy()
    }
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({ validateDocument: expect.any(Function) })
    )
  })

  it('persists writable watchlist updates through the saved-document lifecycle', async () => {
    const sessionId = 'watchlist-write'
    await runYjsUpgrade({ target: { sessionId, entityKind: 'watchlist' } })

    const options = mockSetupWSConnection.mock.calls[0]?.[2]
    expect(options).toEqual(
      expect.objectContaining({
        docId: sessionId,
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
    expect(mockRefreshEntityListSession).toHaveBeenCalledWith('watchlist', 'workspace-1')
    doc.destroy()
  })

  it('allows dashboard layout read-mode websocket upgrades without live persistence callbacks', async () => {
    const sessionId = 'layout-read'
    const { bootstrapState, request, socket, wss } = await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_layout',
        ownerUserId: 'user-1',
      },
      accessMode: 'read',
    })

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('read')
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({
        bootstrapState,
        docId: sessionId,
        accessMode: 'read',
        gc: true,
        onDocumentUpdate: undefined,
      })
    )
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  })

  it('rejects writable dashboard layout websocket upgrades', async () => {
    const sessionId = 'layout-write'
    const { socket, wss } = await runYjsUpgrade({
      target: {
        sessionId,
        entityKind: 'dashboard_layout',
        ownerUserId: 'user-1',
      },
    })

    expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
    expect(mockSetupWSConnection).not.toHaveBeenCalled()
    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('403 Dashboard layout websocket is read-only')
    )
    expect(socket.destroy).toHaveBeenCalledOnce()
  })

  it('rejects websocket upgrades for missing non-entity review sessions', async () => {
    const sessionId = 'review-unbootstrapped'
    const { socket, wss } = await runYjsUpgrade({
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

    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('409 Review target is not bootstrapped')
    )
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})
