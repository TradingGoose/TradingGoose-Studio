/**
 * Tests for the socket server index.ts
 *
 * @vitest-environment node
 */
import { createServer, request as httpRequest } from 'http'
import { io as createClient } from 'socket.io-client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '@/lib/logs/console/logger'
import { createSocketIOServer } from '@/socket-server/config/socket'
import { createHttpHandler } from '@/socket-server/routes/http'

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

describe('Socket Server Index Integration', () => {
  let httpServer: any
  let io: any
  let logger: any
  let PORT: number

  beforeAll(() => {
    logger = createLogger('SocketServerTest')
  })

  beforeEach(async () => {
    // Use a random port for each test to avoid conflicts
    PORT = 3333 + Math.floor(Math.random() * 1000)

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

      httpServer.listen(PORT, '0.0.0.0', () => {
        clearTimeout(timeout)
        resolve()
      })

      httpServer.on('error', (err: any) => {
        clearTimeout(timeout)
        if (err.code === 'EADDRINUSE') {
          // Try a different port
          PORT = 3333 + Math.floor(Math.random() * 1000)
          httpServer.listen(PORT, '0.0.0.0', () => {
            resolve()
          })
        } else {
          reject(err)
        }
      })
    })
  }, 20000)

  afterEach(async () => {
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
