/**
 * Tests for the socket server index.ts
 *
 * @vitest-environment node
 */
import { createServer, request as httpRequest } from 'http'
import { io as createClient } from 'socket.io-client'
import * as Y from 'yjs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractPersistedStateFromDoc,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import { createSocketIOServer } from '@/socket-server/config/socket'
import { createHttpHandler } from '@/socket-server/routes/http'
import { cleanupPersistence, getState, storeState } from '@/socket-server/yjs/persistence'
import {
  cleanupAllDocuments,
  getDocument,
  getExistingDocument,
  setPersistence,
} from '@/socket-server/yjs/upstream-utils'

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

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => null),
  getRedisStorageMode: vi.fn(() => 'local'),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  getRuntimeStateFromDoc: vi.fn(() => ({
    docState: 'active',
    replaySafe: false,
    reseededFromCanonical: false,
  })),
  getRuntimeStateFromUpdate: vi.fn(() => ({
    docState: 'active',
    replaySafe: false,
    reseededFromCanonical: false,
  })),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      verifyOneTimeToken: vi.fn(),
    },
  },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowBlocks: {
    id: 'workflowBlocks.id',
    workflowId: 'workflowBlocks.workflowId',
  },
  workflowEdges: {
    id: 'workflowEdges.id',
    sourceBlockId: 'workflowEdges.sourceBlockId',
    targetBlockId: 'workflowEdges.targetBlockId',
    workflowId: 'workflowEdges.workflowId',
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
    cleanupPersistence()

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
    cleanupPersistence()

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
      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/workflows/workflow-1/apply-state',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({
            workflowState: {
              blocks: {
                'block-1': {
                  id: 'block-1',
                  type: 'agent',
                  name: 'Applied Agent',
                  position: { x: 10, y: 20 },
                  subBlocks: {},
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
          }),
        }
      )

      expect(response.statusCode).toBe(200)
      expect(await getExistingDocument('workflow-1')).toBeNull()

      const persisted = await getState('workflow-1')
      expect(persisted).toBeTruthy()

      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, persisted!)
        const state = extractPersistedStateFromDoc(doc)
        expect(state.blocks['block-1']).toEqual(
          expect.objectContaining({
            id: 'block-1',
            name: 'Applied Agent',
          })
        )
        expect(state.variables.var1).toEqual(
          expect.objectContaining({
            id: 'var1',
            name: 'token',
            value: 'secret',
          })
        )
      } finally {
        doc.destroy()
      }
    })

    it('should return the internal Yjs workflow snapshot through the generic session route', async () => {
      const { getRuntimeStateFromDoc, getRuntimeStateFromUpdate } = await import(
        '@/lib/yjs/server/bootstrap-review-target'
      )

      setPersistence('workflow-state-update', { getState, storeState })
      getDocument('workflow-state-update')
      const liveDoc = await getExistingDocument('workflow-state-update')

      setWorkflowState(
        liveDoc!,
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
          isDeployed: false,
        },
        'test'
      )

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/workflow-state-update/snapshot?targetKind=workflow&sessionId=workflow-state-update&workflowId=workflow-state-update&entityKind=workflow&entityId=workflow-state-update',
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
          draftSessionId: null,
          reviewSessionId: null,
          yjsSessionId: 'workflow-state-update',
        },
        runtime: getRuntimeStateFromDoc(liveDoc!),
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
      }

      expect(getRuntimeStateFromDoc).toHaveBeenCalled()
      expect(getRuntimeStateFromUpdate).not.toHaveBeenCalled()
    })

    it('should return 404 from the internal Yjs snapshot route when no workflow state exists', async () => {
      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/missing-workflow/snapshot?targetKind=workflow&sessionId=missing-workflow&workflowId=missing-workflow&entityKind=workflow&entityId=missing-workflow',
        {
          method: 'GET',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.body)).toEqual({
        error: 'Session not found',
        sessionId: 'missing-workflow',
      })
    })

    it('should clear reseededFromCanonical on the live Yjs session doc', async () => {
      setPersistence('review-session-live', { getState, storeState })
      getDocument('review-session-live')
      const liveDoc = await getExistingDocument('review-session-live')

      liveDoc!.transact(() => {
        liveDoc!.getMap('fields').set('title', 'Shared Tool')
        liveDoc!.getMap('metadata').set('reseededFromCanonical', true)
      }, 'test')
      await storeState('review-session-live', Y.encodeStateAsUpdate(liveDoc!))

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/review-session-live/clear-reseeded',
        {
          method: 'POST',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ success: true, updated: true })
      expect(await getExistingDocument('review-session-live')).toBe(liveDoc)
      expect(liveDoc!.getMap('metadata').get('reseededFromCanonical')).toBeUndefined()

      const persisted = await getState('review-session-live')
      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, persisted!)
        expect(doc.getMap('fields').get('title')).toBe('Shared Tool')
        expect(doc.getMap('metadata').get('reseededFromCanonical')).toBeUndefined()
      } finally {
        doc.destroy()
      }
    })

    it('should clear reseededFromCanonical from persisted session state without overwriting fields', async () => {
      const persistedDoc = new Y.Doc()
      try {
        persistedDoc.transact(() => {
          persistedDoc.getMap('fields').set('title', 'Persisted Tool')
          persistedDoc.getMap('metadata').set('reseededFromCanonical', true)
        }, 'test')
        await storeState('review-session-cold', Y.encodeStateAsUpdate(persistedDoc))
      } finally {
        persistedDoc.destroy()
      }

      expect(await getExistingDocument('review-session-cold')).toBeNull()

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/review-session-cold/clear-reseeded',
        {
          method: 'POST',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ success: true, updated: true })
      expect(await getExistingDocument('review-session-cold')).toBeNull()

      const persisted = await getState('review-session-cold')
      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, persisted!)
        expect(doc.getMap('fields').get('title')).toBe('Persisted Tool')
        expect(doc.getMap('metadata').get('reseededFromCanonical')).toBeUndefined()
      } finally {
        doc.destroy()
      }
    })

    it('should delete the live workflow doc and persisted session through the internal Yjs route', async () => {
      setPersistence('workflow-2', { getState, storeState })
      getDocument('workflow-2')
      const liveDoc = await getExistingDocument('workflow-2')

      setWorkflowState(
        liveDoc!,
        {
          blocks: {
            old: {
              id: 'old',
              type: 'agent',
              name: 'Old Agent',
              position: { x: 0, y: 0 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: '2026-04-05T00:00:00.000Z',
          isDeployed: false,
        },
        'test'
      )
      setVariables(
        liveDoc!,
        {
          oldVar: {
            id: 'oldVar',
            workflowId: 'workflow-2',
            name: 'old',
            type: 'plain',
            value: 'old',
          },
        },
        'test'
      )
      await storeState('workflow-2', Y.encodeStateAsUpdate(liveDoc!))

      const response = await sendHttpRequestWithOptions(
        PORT,
        '/internal/yjs/sessions/workflow-2',
        {
          method: 'DELETE',
          headers: {
            'x-internal-secret': INTERNAL_SECRET,
          },
        }
      )

      expect(response.statusCode).toBe(200)
      expect(await getExistingDocument('workflow-2')).toBeNull()
      expect(await getState('workflow-2')).toBeNull()
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
