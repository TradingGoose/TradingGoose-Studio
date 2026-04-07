/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const mockAuthenticateYjsConnection = vi.fn()
const mockVerifyReviewTargetAccess = vi.fn()
const mockGetExistingDocument = vi.fn()
const mockSetPersistence = vi.fn()
const mockSetupWSConnection = vi.fn()
const mockGetState = vi.fn()
const mockStoreState = vi.fn()

class MockYjsAuthError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message)
    this.name = 'YjsAuthError'
  }
}

function createRequest(sessionId: string): IncomingMessage {
  return {
    url: `/yjs/${encodeURIComponent(sessionId)}?token=test-token&targetKind=workflow&sessionId=${encodeURIComponent(sessionId)}&workflowId=${encodeURIComponent(sessionId)}&entityKind=workflow&entityId=${encodeURIComponent(sessionId)}`,
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
  mockVerifyReviewTargetAccess.mockReset()
  mockGetExistingDocument.mockReset()
  mockSetPersistence.mockReset()
  mockSetupWSConnection.mockReset()
  mockGetState.mockReset()
  mockStoreState.mockReset()

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
    getRuntimeStateFromDoc: vi.fn((doc) => ({
      docState: doc.getMap('metadata').get('docState') === 'expired' ? 'expired' : 'active',
      replaySafe: doc.getMap('metadata').get('reseededFromCanonical') !== true,
      reseededFromCanonical: doc.getMap('metadata').get('reseededFromCanonical') === true,
    })),
    getRuntimeStateFromUpdate: vi.fn((update: Uint8Array) => {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, update)
      return {
        docState: doc.getMap('metadata').get('docState') === 'expired' ? 'expired' : 'active',
        replaySafe: doc.getMap('metadata').get('reseededFromCanonical') !== true,
        reseededFromCanonical: doc.getMap('metadata').get('reseededFromCanonical') === true,
      }
    }),
  }))

  vi.doMock('./upstream-utils', () => ({
    getExistingDocument: mockGetExistingDocument,
    setPersistence: mockSetPersistence,
    setupWSConnection: mockSetupWSConnection,
  }))

  vi.doMock('./persistence', () => ({
    getState: mockGetState,
    storeState: mockStoreState,
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
        targetKind: 'workflow',
        sessionId,
        workflowId: sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
      },
    })

    mockVerifyReviewTargetAccess.mockImplementation(async (_userId, _target, options) => ({
      hasAccess: !options.requireWrite,
      userPermission: 'read',
      workspaceId: 'workspace-1',
      isOwner: false,
    }))

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toEqual({ requireWrite: true })
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
        targetKind: 'workflow',
        sessionId,
        workflowId: sessionId,
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
    mockGetState.mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))

    const { handleYjsUpgrade } = await loadModule()
    handleYjsUpgrade(wss, request, socket, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledTimes(1)
    expect(mockVerifyReviewTargetAccess.mock.calls[0]?.[2]).toEqual({ requireWrite: true })
    expect(mockSetPersistence).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        getState: expect.any(Function),
        storeState: expect.any(Function),
      })
    )
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSetupWSConnection).toHaveBeenCalledWith(
      expect.anything(),
      request,
      expect.objectContaining({ docId: sessionId, gc: true })
    )
    expect(socket.write).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  })

  it('rejects websocket upgrades when the review target has not been bootstrapped yet', async () => {
    const sessionId = 'workflow-unbootstrapped'
    const request = createRequest(sessionId)
    const socket = createSocket()
    const wss = createWebSocketServer()

    mockAuthenticateYjsConnection.mockResolvedValue({
      userId: 'user-3',
      userName: 'User Three',
      envelope: {
        targetKind: 'workflow',
        sessionId,
        workflowId: sessionId,
        reviewSessionId: null,
        workspaceId: 'workspace-3',
        entityKind: 'workflow',
        entityId: sessionId,
        draftSessionId: null,
      },
    })

    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      userPermission: 'write',
      workspaceId: 'workspace-3',
      isOwner: false,
    })
    mockGetExistingDocument.mockResolvedValue(null)
    mockGetState.mockResolvedValue(null)

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
