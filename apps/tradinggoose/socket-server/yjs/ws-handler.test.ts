/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocketServer } from 'ws'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const mockAuthenticateYjsConnection = vi.fn()
const mockCreateEntityListBootstrapUpdate = vi.fn()
const mockCreateSavedReviewTargetBootstrapUpdate = vi.fn()
const mockVerifyReviewTargetAccess = vi.fn()
const mockGetExistingDocument = vi.fn()
const mockSetupWSConnection = vi.fn()

class MockYjsAuthError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
    this.name = 'YjsAuthError'
  }
}

function createRequest(sessionId: string, accessMode: 'read' | 'write' = 'write'): IncomingMessage {
  return {
    url: `/yjs/${encodeURIComponent(sessionId)}?token=test-token&accessMode=${accessMode}&targetKind=entity&sessionId=${encodeURIComponent(sessionId)}&entityKind=workflow&entityId=${encodeURIComponent(sessionId)}`,
    headers: { host: 'localhost:3000' },
  } as IncomingMessage
}

function createDashboardRequest(
  sessionId: string,
  accessMode: 'read' | 'write' = 'write'
): IncomingMessage {
  return {
    url: `/yjs/${encodeURIComponent(sessionId)}?token=test-token&accessMode=${accessMode}&targetKind=entity&sessionId=${encodeURIComponent(sessionId)}&entityKind=dashboard_layout&entityId=${encodeURIComponent(sessionId)}&workspaceId=workspace-1&ownerUserId=user-1`,
    headers: { host: 'localhost:3000' },
  } as IncomingMessage
}

function createReviewSessionRequest(sessionId: string): IncomingMessage {
  return {
    url: `/yjs/${encodeURIComponent(sessionId)}?token=test-token&accessMode=write&targetKind=review_session&sessionId=${encodeURIComponent(sessionId)}&reviewSessionId=${encodeURIComponent(sessionId)}&workspaceId=workspace-3&entityKind=skill&draftSessionId=draft-1`,
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

beforeEach(() => {
  vi.resetModules()

  mockAuthenticateYjsConnection.mockReset()
  mockCreateEntityListBootstrapUpdate.mockReset()
  mockCreateSavedReviewTargetBootstrapUpdate.mockReset()
  mockVerifyReviewTargetAccess.mockReset()
  mockGetExistingDocument.mockReset()
  mockSetupWSConnection.mockReset()

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
    createEntityListBootstrapUpdate: mockCreateEntityListBootstrapUpdate,
    createSavedReviewTargetBootstrapUpdate: mockCreateSavedReviewTargetBootstrapUpdate,
    getRuntimeStateFromDoc: vi.fn((doc) => ({
      docState: doc.getMap('metadata').get('docState') === 'expired' ? 'expired' : 'active',
      replaySafe: doc.getMap('metadata').get('reseededFromCanonical') !== true,
      reseededFromCanonical: doc.getMap('metadata').get('reseededFromCanonical') === true,
    })),
  }))

  vi.doMock('@/lib/workflows/db-helpers', () => ({
    saveWorkflowYjsDocToDb: vi.fn(),
  }))

  vi.doMock('@/lib/yjs/server/apply-entity-state', () => ({
    saveSavedEntityYjsDocToDb: vi.fn(),
  }))

  vi.doMock('./upstream-utils', () => ({
    getExistingDocument: mockGetExistingDocument,
    setupWSConnection: mockSetupWSConnection,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('handleYjsUpgrade', () => {
  it('rejects websocket upgrades when the Yjs auth token is invalid', async () => {
    const sessionId = 'workflow-invalid-token'
    const request = createRequest(sessionId)
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
    const request = createRequest(sessionId)
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-1',
      userName: 'User One',
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

    mockVerifyReviewTargetAccess.mockImplementation(async (_userId, _target, accessMode) => ({
      hasAccess: false,
      userPermission: accessMode,
      workspaceId: 'workspace-1',
      isOwner: false,
    }))

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('write')
    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'))
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('allows websocket upgrades for write access', async () => {
    const sessionId = 'workflow-456'
    const request = createRequest(sessionId)
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-2',
      userName: 'User Two',
      envelope: {
        targetKind: 'entity',
        sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-2',
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
      },
    })

    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'write',
      workspaceId: 'workspace-2',
      isOwner: false,
    })
    mockGetExistingDocument.mockResolvedValue(null)
    const bootstrapState = new Uint8Array([0, 0])
    mockCreateSavedReviewTargetBootstrapUpdate.mockResolvedValue({
      descriptor: {
        workspaceId: 'workspace-2',
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
        reviewSessionId: null,
        yjsSessionId: sessionId,
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: true,
      },
      state: bootstrapState,
    })

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toBe('write')
    expect(mockCreateSavedReviewTargetBootstrapUpdate).toHaveBeenCalled()
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
      })
    )
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  })

  it('rejects non-dashboard read-mode websocket upgrades after target authentication', async () => {
    const sessionId = 'workflow-read'
    const request = createRequest(sessionId, 'read')
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-1',
      userName: 'User One',
      envelope: {
        targetKind: 'entity',
        sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-1',
        ownerUserId: null,
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
      },
    })

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockAuthenticateYjsConnection).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('403 Yjs websocket requires write access')
    )
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('allows dashboard layout read-mode websocket upgrades without live persistence callbacks', async () => {
    const sessionId = 'layout-read'
    const request = createDashboardRequest(sessionId, 'read')
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-1',
      userName: 'User One',
      envelope: {
        targetKind: 'entity',
        sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        entityKind: 'dashboard_layout',
        entityId: sessionId,
        draftSessionId: null,
      },
    })
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: true,
    })
    mockGetExistingDocument.mockResolvedValue(null)
    const bootstrapState = new Uint8Array([1, 2])
    mockCreateSavedReviewTargetBootstrapUpdate.mockResolvedValue({
      descriptor: {
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        entityKind: 'dashboard_layout',
        entityId: sessionId,
        draftSessionId: null,
        reviewSessionId: null,
        yjsSessionId: sessionId,
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: true,
      },
      state: bootstrapState,
    })

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

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
        onDocumentIdle: undefined,
        onDocumentUpdate: undefined,
      })
    )
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  })

  it('rejects websocket upgrades for missing non-entity review sessions', async () => {
    const sessionId = 'review-unbootstrapped'
    const request = createReviewSessionRequest(sessionId)
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-3',
      userName: 'User Three',
      envelope: {
        targetKind: 'review_session',
        sessionId,
        reviewSessionId: sessionId,
        workspaceId: 'workspace-3',
        entityKind: 'skill',
        entityId: null,
        draftSessionId: 'draft-1',
      },
    })

    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'write',
      workspaceId: 'workspace-3',
      isOwner: false,
    })
    mockGetExistingDocument.mockResolvedValue(null)

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(wss.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('409 Review target is not bootstrapped')
    )
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})
