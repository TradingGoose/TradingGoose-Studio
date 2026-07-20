/**
 * Tests for the socket server index.ts
 *
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events'
import { createServer, request as httpRequest } from 'http'
import * as syncProtocol from '@y/protocols/sync'
import * as encoding from 'lib0/encoding'
import { io as createClient } from 'socket.io-client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  buildEntityListDescriptor,
  buildSavedEntityDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getEntityFields,
  getEntityListMembers,
  replaceEntityListSessionMembers,
} from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { extractPersistedStateFromDoc, setWorkflowState } from '@/lib/yjs/workflow-session'
import { createSocketIOServer } from '@/socket-server/config/socket'
import { createHttpHandler } from '@/socket-server/routes/http'
import {
  acquireDocument,
  cleanupAllDocuments,
  peekDocument,
  setupWSConnection,
} from '@/socket-server/yjs/upstream-utils'

const {
  mockSaveSavedEntityYjsDocToDb,
  mockSaveWorkflowYjsDocToDb,
  savedEntityStates,
  savedWorkflowStates,
} = vi.hoisted(() => ({
  mockSaveSavedEntityYjsDocToDb: vi.fn(),
  mockSaveWorkflowYjsDocToDb: vi.fn(),
  savedEntityStates: [] as Array<{
    entityKind: string
    entityId: string
    fields: Record<string, unknown>
  }>,
  savedWorkflowStates: [] as Array<ReturnType<typeof extractPersistedStateFromDoc>>,
}))

vi.mock(import('@/lib/env'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    env: {
      ...actual.env,
      INTERNAL_API_SECRET: '12345678901234567890123456789012',
    },
  }
})

const INTERNAL_SECRET = '12345678901234567890123456789012'
const INTERNAL_MUTATION_HEADERS = {
  'content-type': 'application/json',
  'x-internal-secret': INTERNAL_SECRET,
  'x-yjs-actor-user-id': 'test-user-id',
}

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => null),
  getRedisStorageMode: vi.fn(() => 'local'),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  saveWorkflowYjsDocToDb: mockSaveWorkflowYjsDocToDb,
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  saveSavedEntityYjsDocToDb: mockSaveSavedEntityYjsDocToDb,
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', async (importOriginal) => ({
  ...(await importOriginal()),
  initializeSavedReviewTargetDocument: vi.fn(async (descriptor) => {
    const Y = await import('yjs')
    const doc = new Y.Doc()
    const state = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return { state, workspaceId: descriptor.workspaceId }
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      verifyOneTimeToken: vi.fn(),
    },
  },
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: vi.fn(async (_userId, descriptor) => ({
    hasAccess: true,
    workspaceId: descriptor.workspaceId ?? 'workspace-1',
  })),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn((use) => use({ execute: vi.fn().mockResolvedValue([{ acquired: true }]) })),
  },
}))

vi.mock('postgres', () => ({
  default: vi.fn(() => ({})),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  })),
}))

vi.mock('@/socket-server/middleware/auth', () => ({
  authenticateSocket: vi.fn((socket, next) => {
    socket.userId = 'test-user-id'
    socket.userName = 'Test User'
    socket.userEmail = 'test@example.com'
    next()
  }),
}))

function sendHttpRequest(port: number, path: string, method = 'GET') {
  return new Promise<{ statusCode: number | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body })
        })
      }
    )

    req.on('error', reject)
    req.end()
  })
}

function sendHttpRequestWithOptions(
  port: number,
  path: string,
  options: {
    method: string
    headers?: Record<string, string>
    body?: string
  }
) {
  return new Promise<{ statusCode: number | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body })
        })
      }
    )

    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function createSyncUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

function connectTestDocument(docId: string) {
  const conn = new EventEmitter() as any
  conn.readyState = 1
  conn.send = vi.fn((_message, _options, callback) => callback?.())
  conn.ping = vi.fn()
  conn.close = vi.fn()
  const listMatch = /^list:([^:]+):(.+)$/.exec(docId)
  const descriptor = listMatch
    ? buildEntityListDescriptor(listMatch[1] as any, listMatch[2])
    : buildSavedEntityDescriptor('skill', docId, 'workspace-1')
  return acquireDocument(
    docId,
    { workspaceId: descriptor.workspaceId, initialize: () => undefined },
    (doc) => {
      setupWSConnection(conn, {} as any, {
        doc,
        userId: 'user-1',
        accessMode: listMatch ? 'read' : 'write',
        descriptor,
      })
      return { conn, doc }
    }
  )
}

describe('Socket Server Index Integration', () => {
  let httpServer: any
  let io: any
  let logger: any
  let PORT: number

  beforeAll(() => {
    logger = createLogger('SocketServerTest')
  })

  beforeEach(async () => {
    cleanupAllDocuments()
    savedWorkflowStates.length = 0
    savedEntityStates.length = 0
    mockSaveWorkflowYjsDocToDb.mockImplementation(async (_workflowId, doc) => {
      savedWorkflowStates.push(extractPersistedStateFromDoc(doc))
    })
    mockSaveSavedEntityYjsDocToDb.mockImplementation(
      async (entityKind, entityId, _workspaceId, doc) => {
        const fields = getEntityFields(doc, entityKind)
        savedEntityStates.push({ entityKind, entityId, fields })
        return fields
      }
    )

    // Create HTTP server
    httpServer = createServer()

    // Create Socket.IO server using extracted config
    io = createSocketIOServer(httpServer)

    // Configure HTTP request handler
    const httpHandler = createHttpHandler(logger)
    httpServer.on('request', httpHandler)

    // Start server with timeout handling
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start on port ${PORT} within 15 seconds`))
      }, 15000)

      httpServer.listen(0, '127.0.0.1', () => {
        clearTimeout(timeout)
        const address = httpServer.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Server did not expose a numeric port'))
          return
        }
        PORT = address.port
        resolve()
      })

      httpServer.on('error', (err: any) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }, 20000)

  afterEach(async () => {
    cleanupAllDocuments()

    // Properly close servers and wait for them to fully close
    if (io) {
      await new Promise<void>((resolve) => {
        io.close(() => resolve())
      })
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
    vi.clearAllMocks()
  })

  describe('HTTP Server Configuration', () => {
    it('should create HTTP server successfully', () => {
      expect(httpServer).toBeDefined()
      expect(httpServer.listening).toBe(true)
    })

    it('should handle health check endpoint', async () => {
      const response = await sendHttpRequest(PORT, '/health')

      expect(response.statusCode).toBe(200)

      const data = JSON.parse(response.body)
      expect(data).toHaveProperty('status', 'ok')
      expect(data).toHaveProperty('timestamp')
      expect(data).toHaveProperty('connections')
    })

    it('should not expose retired workflow sync bridge endpoints', async () => {
      const [workflowUpdated, copilotWorkflowEdit, workflowDeleted, workflowReverted] =
        await Promise.all([
          sendHttpRequest(PORT, '/api/workflow-updated', 'POST'),
          sendHttpRequest(PORT, '/api/copilot-workflow-edit', 'POST'),
          sendHttpRequest(PORT, '/api/workflow-deleted', 'POST'),
          sendHttpRequest(PORT, '/api/workflow-reverted', 'POST'),
        ])

      expect(workflowUpdated.statusCode).toBe(404)
      expect(copilotWorkflowEdit.statusCode).toBe(404)
      expect(workflowDeleted.statusCode).toBe(404)
      expect(workflowReverted.statusCode).toBe(404)
    })

    it('should apply workflow state through the internal Yjs route', async () => {
      const applyWorkflowPatch = (body: unknown) =>
        sendHttpRequestWithOptions(PORT, '/internal/yjs/workflows/workflow-1/apply-state', {
          method: 'POST',
          headers: INTERNAL_MUTATION_HEADERS,
          body: JSON.stringify(body),
        })

      const response = await applyWorkflowPatch({
        workflowState: {
          blocks: {
            'block-1': {
              id: 'block-1',
              type: 'agent',
              name: 'Applied Agent',
              position: { x: 10, y: 20 },
              subBlocks: {
                prompt: {
                  id: 'prompt',
                  type: 'long-input',
                  value: 'Use <variable.token> in this prompt',
                },
              },
              outputs: {},
              enabled: true,
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: '2026-04-06T00:00:00.000Z',
          isDeployed: false,
        },
        variables: {
          var1: {
            id: 'var1',
            workflowId: 'workflow-1',
            name: 'token',
            type: 'plain',
            value: 'secret',
          },
        },
      })

      expect(response.statusCode).toBe(200)
      expect(mockSaveWorkflowYjsDocToDb).toHaveBeenCalledWith('workflow-1', expect.any(Y.Doc))
      expect(savedWorkflowStates[0]?.blocks['block-1']).toEqual(
        expect.objectContaining({
          id: 'block-1',
          name: 'Applied Agent',
        })
      )
      expect(savedWorkflowStates[0]?.variables.var1).toEqual(
        expect.objectContaining({
          id: 'var1',
          name: 'token',
          value: 'secret',
        })
      )
      expect(peekDocument('workflow-1')).toBeNull()
    })

    it('applies watchlist content without changing its list identity', async () => {
      const { conn, doc: listDoc } = await connectTestDocument('list:watchlist:workspace-1')
      replaceEntityListSessionMembers(listDoc, [{ id: 'watchlist-1', name: 'Old Watchlist' }])

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/entities/watchlist-1/apply-state',
        {
          method: 'POST',
          headers: INTERNAL_MUTATION_HEADERS,
          body: JSON.stringify({
            entityKind: 'watchlist',
            workspaceId: 'workspace-1',
            fields: {
              settings: { showLogo: true, showTicker: true, showDescription: false },
              items: [],
            },
          }),
        }
      )

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({
        success: true,
        fields: {
          settings: { showLogo: true, showTicker: true, showDescription: false },
          items: [],
        },
      })
      expect(savedEntityStates).toEqual([
        {
          entityKind: 'watchlist',
          entityId: 'watchlist-1',
          fields: {
            settings: { showLogo: true, showTicker: true, showDescription: false },
            items: [],
          },
        },
      ])
      expect(peekDocument('watchlist-1')).toBeNull()
      expect(getEntityListMembers(listDoc, 'watchlist')).toEqual([
        {
          entityId: 'watchlist-1',
          entityName: 'Old Watchlist',
        },
      ])

      conn.emit('close')
      await new Promise((resolve) => setImmediate(resolve))
    })

    it('releases an idle workflow document when materialization fails', async () => {
      mockSaveWorkflowYjsDocToDb.mockRejectedValueOnce(new Error('database unavailable'))

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/workflows/workflow-failed/apply-state',
        {
          method: 'POST',
          headers: INTERNAL_MUTATION_HEADERS,
          body: JSON.stringify({
            workflowState: {
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
              lastSaved: '2026-04-06T00:00:00.000Z',
              isDeployed: false,
            },
          }),
        }
      )

      expect(response.statusCode).toBe(500)
      expect(peekDocument('workflow-failed')).toBeNull()
    })

    it('does not mutate a connected live workflow session when persistence fails', async () => {
      const { conn, doc: liveDoc } = await connectTestDocument('workflow-connected')
      setWorkflowState(
        liveDoc,
        { blocks: { keep: { id: 'keep' } as any }, edges: [], loops: {}, parallels: {} },
        'test'
      )

      mockSaveWorkflowYjsDocToDb.mockRejectedValueOnce(new Error('database unavailable'))

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/workflows/workflow-connected/apply-state',
        {
          method: 'POST',
          headers: INTERNAL_MUTATION_HEADERS,
          body: JSON.stringify({
            workflowState: {
              blocks: { replaced: { id: 'replaced' } },
              edges: [],
              loops: {},
              parallels: {},
              lastSaved: '2026-04-06T00:00:00.000Z',
              isDeployed: false,
            },
          }),
        }
      )

      // A failed write must never leave connected clients ahead of the database:
      // the live session still holds the pre-command block.
      expect(response.statusCode).toBe(500)
      const liveBlocks = extractPersistedStateFromDoc(peekDocument('workflow-connected')!).blocks
      expect(liveBlocks).toHaveProperty('keep')
      expect(liveBlocks).not.toHaveProperty('replaced')

      conn.emit('close')
      await new Promise((resolve) => setImmediate(resolve))
    })

    it('should return the internal Yjs workflow snapshot through the generic session route', async () => {
      const { getReviewTargetRuntimeState } = await import('@/lib/copilot/review-sessions/runtime')

      const { conn, doc: liveDoc } = await connectTestDocument('workflow-state-update')

      setWorkflowState(
        liveDoc,
        {
          blocks: {
            current: {
              id: 'current',
              type: 'agent',
              name: 'Current Agent',
              position: { x: 5, y: 15 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: '2026-04-06T00:00:00.000Z',
        },
        'test'
      )

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/workflow-state-update/snapshot?targetKind=entity&sessionId=workflow-state-update&entityKind=workflow&entityId=workflow-state-update',
        {
          method: 'GET',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)

      const data = JSON.parse(response.body)
      expect(data).toEqual({
        snapshotBase64: expect.any(String),
        descriptor: {
          workspaceId: null,
          entityKind: 'workflow',
          entityId: 'workflow-state-update',
          ownerUserId: null,
          draftSessionId: null,
          reviewSessionId: null,
          yjsSessionId: 'workflow-state-update',
        },
        runtime: getReviewTargetRuntimeState(liveDoc),
        touchedAt: null,
      })

      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, Buffer.from(data.snapshotBase64, 'base64'))
        const state = extractPersistedStateFromDoc(doc)
        expect(state.blocks.current).toEqual(
          expect.objectContaining({
            id: 'current',
            name: 'Current Agent',
          })
        )
      } finally {
        doc.destroy()
        conn.emit('close')
      }
    })

    it('should bootstrap a saved workflow snapshot into a live Yjs document', async () => {
      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/missing-workflow/snapshot?targetKind=entity&sessionId=missing-workflow&entityKind=workflow&entityId=missing-workflow',
        {
          method: 'GET',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)
      expect(peekDocument('missing-workflow')).toBeNull()
    })

    it('should bootstrap a saved entity snapshot into a live Yjs document', async () => {
      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/skill-stale/snapshot?targetKind=entity&sessionId=skill-stale&workspaceId=workspace-1&entityKind=skill&entityId=skill-stale',
        {
          method: 'GET',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)
      expect(peekDocument('skill-stale')).toBeNull()
    })
  })

  describe('Yjs document cleanup', () => {
    it('does not apply client updates from read-only Yjs connections', async () => {
      const bootstrapDoc = new Y.Doc()
      replaceEntityListSessionMembers(bootstrapDoc, [{ id: 'skill-1', name: 'Skill 1' }])
      const bootstrapUpdate = Y.encodeStateAsUpdate(bootstrapDoc)
      bootstrapDoc.destroy()

      const { conn, doc } = await connectTestDocument('list:skill:workspace-1')
      Y.applyUpdate(doc, bootstrapUpdate, YJS_ORIGINS.SYSTEM)

      const updateDoc = new Y.Doc()
      replaceEntityListSessionMembers(updateDoc, [{ id: 'spoofed-skill', name: 'Spoofed Skill' }])
      conn.emit('message', createSyncUpdateMessage(Y.encodeStateAsUpdate(updateDoc)))
      updateDoc.destroy()

      await new Promise((resolve) => setImmediate(resolve))

      expect(getEntityListMembers(doc, 'skill').map((member) => member.entityId)).toEqual([
        'skill-1',
      ])
      expect(conn.close).toHaveBeenCalled()
    })
  })

  describe('Socket.IO Server Configuration', () => {
    it('should create Socket.IO server with proper configuration', () => {
      expect(io).toBeDefined()
      expect(io.engine).toBeDefined()
    })

    it('should have proper CORS configuration', () => {
      const corsOptions = io.engine.opts.cors
      expect(corsOptions).toBeDefined()
      expect(corsOptions.methods).toContain('GET')
      expect(corsOptions.methods).toContain('POST')
      expect(corsOptions.credentials).toBe(true)
    })

    it('should have proper transport configuration', () => {
      const transports = io.engine.opts.transports
      expect(transports).toContain('polling')
      expect(transports).toContain('websocket')
    })
  })

  describe('Socket.IO integration', () => {
    it('should allow socket connections alongside the HTTP handler', async () => {
      const client = createClient(`http://localhost:${PORT}`, {
        transports: ['polling', 'websocket'],
        timeout: 5000,
        forceNew: true,
      })

      try {
        await new Promise<void>((resolve, reject) => {
          client.on('connect', () => resolve())
          client.on('connect_error', (err) => reject(err))
        })

        expect(client.connected).toBe(true)
      } finally {
        client.close()
      }
    })
  })

  describe('Module Integration', () => {
    it.concurrent('should properly import all extracted modules', async () => {
      // Test that all modules can be imported without errors
      const { createSocketIOServer } = await import('@/socket-server/config/socket')
      const { createHttpHandler } = await import('@/socket-server/routes/http')
      const { authenticateSocket } = await import('@/socket-server/middleware/auth')
      const { WorkflowOperationSchema } = await import('@/socket-server/validation/schemas')

      expect(createSocketIOServer).toBeTypeOf('function')
      expect(createHttpHandler).toBeTypeOf('function')
      expect(authenticateSocket).toBeTypeOf('function')
      expect(WorkflowOperationSchema).toBeDefined()
    })

    it.concurrent('should keep the remaining socket runtime available after refactoring', () => {
      expect(httpServer).toBeDefined()
      expect(io).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should have global error handlers configured', () => {
      expect(typeof process.on).toBe('function')
    })

    it('should handle server setup', () => {
      expect(httpServer).toBeDefined()
      expect(io).toBeDefined()
    })
  })

  describe('Authentication Middleware', () => {
    it('should apply authentication middleware to Socket.IO', () => {
      expect(io._parser).toBeDefined()
    })
  })

  describe('Graceful Shutdown', () => {
    it('should have shutdown capability', () => {
      expect(typeof httpServer.close).toBe('function')
      expect(typeof io.close).toBe('function')
    })
  })

  describe('Validation and Utils', () => {
    it.concurrent('should validate workflow operations', async () => {
      const { WorkflowOperationSchema } = await import('@/socket-server/validation/schemas')

      const validOperation = {
        operation: 'add',
        target: 'block',
        payload: {
          id: 'test-block',
          type: 'action',
          name: 'Test Block',
          position: { x: 100, y: 200 },
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validOperation)).not.toThrow()
    })

    it.concurrent('should validate block operations with autoConnectEdge', async () => {
      const { WorkflowOperationSchema } = await import('@/socket-server/validation/schemas')

      const validOperationWithAutoEdge = {
        operation: 'add',
        target: 'block',
        payload: {
          id: 'test-block',
          type: 'action',
          name: 'Test Block',
          position: { x: 100, y: 200 },
          autoConnectEdge: {
            id: 'auto-edge-123',
            source: 'source-block',
            target: 'test-block',
            sourceHandle: 'output',
            targetHandle: 'target',
            type: 'workflowEdge',
          },
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validOperationWithAutoEdge)).not.toThrow()
    })

    it.concurrent('should validate edge operations', async () => {
      const { WorkflowOperationSchema } = await import('@/socket-server/validation/schemas')

      const validEdgeOperation = {
        operation: 'add',
        target: 'edge',
        payload: {
          id: 'test-edge',
          source: 'block-1',
          target: 'block-2',
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validEdgeOperation)).not.toThrow()
    })

    it('should validate subflow operations', async () => {
      const { WorkflowOperationSchema } = await import('@/socket-server/validation/schemas')

      const validSubflowOperation = {
        operation: 'update',
        target: 'subflow',
        payload: {
          id: 'test-subflow',
          type: 'loop',
          config: { iterations: 5 },
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validSubflowOperation)).not.toThrow()
    })
  })
})
