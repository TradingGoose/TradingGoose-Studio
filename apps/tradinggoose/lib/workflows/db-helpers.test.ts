/**
 * @vitest-environment node
 *
 * Database Helpers Unit Tests
 *
 * Tests for normalized table operations including loading, saving, and migrating
 * workflow data between JSON blob format and normalized database tables.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { setVariables, setWorkflowState } from '@/lib/yjs/workflow-session'

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}

const mockWebhook = {
  workflowId: 'workflowId',
  provider: 'provider',
}

const mockWorkflowTable = {
  id: 'id',
  variables: 'variables',
  lastSynced: 'lastSynced',
  userId: 'userId',
}

const mockWorkflowDeploymentVersion = {
  id: 'id',
  workflowId: 'workflowId',
  version: 'version',
  state: 'state',
  isActive: 'isActive',
  createdAt: 'createdAt',
  createdBy: 'createdBy',
  deployedBy: 'deployedBy',
}

const mockWorkflowBlocks = {
  workflowId: 'workflowId',
  id: 'id',
  type: 'type',
  name: 'name',
  positionX: 'positionX',
  positionY: 'positionY',
  enabled: 'enabled',
  horizontalHandles: 'horizontalHandles',
  isWide: 'isWide',
  height: 'height',
  subBlocks: 'subBlocks',
  outputs: 'outputs',
  data: 'data',
  parentId: 'parentId',
  extent: 'extent',
}

const mockWorkflowEdges = {
  workflowId: 'workflowId',
  id: 'id',
  sourceBlockId: 'sourceBlockId',
  targetBlockId: 'targetBlockId',
  sourceHandle: 'sourceHandle',
  targetHandle: 'targetHandle',
}

const mockWorkflowSubflows = {
  workflowId: 'workflowId',
  id: 'id',
  type: 'type',
  config: 'config',
}

vi.doMock('@tradinggoose/db', () => ({
  db: mockDb,
  webhook: mockWebhook,
  workflow: mockWorkflowTable,
  workflowBlocks: mockWorkflowBlocks,
  workflowEdges: mockWorkflowEdges,
  workflowSubflows: mockWorkflowSubflows,
  workflowDeploymentVersion: mockWorkflowDeploymentVersion,
}))

vi.doMock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  desc: vi.fn((field) => ({ field, type: 'desc' })),
  inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
  ne: vi.fn((field, value) => ({ field, value, type: 'ne' })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: String.raw({ raw: strings }, ...values.map(String)),
      values,
      type: 'sql',
    })),
    { raw: vi.fn((value: string) => ({ text: value, values: [], type: 'sql.raw' })) }
  ),
}))

vi.doMock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

const mockReconcilePublishedChatsForDeploymentTx = vi.fn()
const mockGetYjsSnapshot = vi.fn()
class MockSocketServerBridgeError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(body)
    this.name = 'SocketServerBridgeError'
  }
}
vi.doMock('@/lib/yjs/server/snapshot-bridge', () => ({
  getYjsSnapshot: mockGetYjsSnapshot,
  SocketServerBridgeError: MockSocketServerBridgeError,
}))

vi.doMock('@/lib/chat/published-deployment', () => ({
  reconcilePublishedChatsForDeploymentTx: mockReconcilePublishedChatsForDeploymentTx,
}))

const mockWorkflowId = 'test-workflow-123'

function buildWorkflowSnapshotResponse(update: Uint8Array) {
  return {
    snapshotBase64: Buffer.from(update).toString('base64'),
    descriptor: {
      workspaceId: null,
      entityKind: 'workflow' as const,
      entityId: mockWorkflowId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: mockWorkflowId,
    },
    runtime: {
      docState: 'active' as const,
      replaySafe: true,
      reseededFromCanonical: false,
    },
  }
}

const mockBlocksFromDb = [
  {
    id: 'block-1',
    workflowId: mockWorkflowId,
    type: 'input_trigger',
    name: 'Trigger Block',
    positionX: 100,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    advancedMode: false,
    triggerMode: false,
    height: 150,
    subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
    outputs: { result: { type: 'string' } },
    data: { parentId: null, extent: null, width: 350 },
    parentId: null,
    extent: null,
  },
  {
    id: 'block-2',
    workflowId: mockWorkflowId,
    type: 'api',
    name: 'API Block',
    positionX: 300,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: true,
    height: 200,
    subBlocks: {},
    outputs: {},
    data: { parentId: 'loop-1', extent: 'parent' },
    parentId: 'loop-1',
    extent: 'parent',
  },
]

const mockEdgesFromDb = [
  {
    id: 'edge-1',
    workflowId: mockWorkflowId,
    sourceBlockId: 'block-1',
    targetBlockId: 'block-2',
    sourceHandle: 'output',
    targetHandle: 'input',
  },
]

const mockSubflowsFromDb = [
  {
    id: 'loop-1',
    workflowId: mockWorkflowId,
    type: 'loop',
    config: {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  {
    id: 'parallel-1',
    workflowId: mockWorkflowId,
    type: 'parallel',
    config: {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
]

const mockWorkflowState: WorkflowState = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'input_trigger',
      name: 'Start Block',
      position: { x: 100, y: 100 },
      subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
      outputs: { result: { type: 'string' } },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 150,
      data: { width: 350 },
    },
    'block-2': {
      id: 'block-2',
      type: 'api',
      name: 'API Block',
      position: { x: 300, y: 100 },
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      isWide: true,
      height: 200,
      data: { parentId: 'loop-1', extent: 'parent' },
    },
  },
  edges: [
    {
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
  ],
  loops: {
    'loop-1': {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
  lastSaved: Date.now(),
  isDeployed: false,
  deploymentStatuses: {},
}

const createMockTx = (overrides: Partial<Record<'delete' | 'execute' | 'insert' | 'update', any>> = {}) => ({
  execute: overrides.execute ?? vi.fn().mockResolvedValue([]),
  update:
    overrides.update ??
    vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  delete:
    overrides.delete ??
    vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  insert:
    overrides.insert ??
    vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
})

const mockNoConflictingBlockIds = () => {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  })
}

describe('Database Helpers', () => {
  let dbHelpers: typeof import('@/lib/workflows/db-helpers')

  beforeAll(async () => {
    dbHelpers = await import('@/lib/workflows/db-helpers')
  }, 30000)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetYjsSnapshot.mockRejectedValue(new MockSocketServerBridgeError(404, 'Not found'))
    mockReconcilePublishedChatsForDeploymentTx.mockResolvedValue(undefined)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('loadWorkflowFromNormalizedTables', () => {
    it('should successfully load workflow data from normalized tables', async () => {
      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve(mockBlocksFromDb)
            }
            if (callCount === 2) {
              return Promise.resolve(mockEdgesFromDb)
            }
            if (callCount === 3) {
              return Promise.resolve(mockSubflowsFromDb)
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(result).toBeDefined()
      expect(result?.isFromNormalizedTables).toBe(true)
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
      expect(result?.loops).toBeDefined()
      expect(result?.parallels).toBeDefined()

      // Verify blocks are transformed correctly
      expect(result?.blocks['block-1']).toEqual({
        id: 'block-1',
        type: 'input_trigger',
        name: 'Trigger Block',
        position: { x: 100, y: 100 },
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        locked: false,
        height: 150,
        subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
        outputs: { result: { type: 'string' } },
        data: { parentId: null, extent: null, width: 350 },
        advancedMode: false,
        layout: {},
        triggerMode: false,
      })

      // Verify edges are transformed correctly
      expect(result?.edges[0]).toEqual({
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: {},
      })

      // Verify loops are transformed correctly
      expect(result?.loops['loop-1']).toEqual({
        id: 'loop-1',
        nodes: ['block-2'],
        iterations: 5,
        loopType: 'for',
        forEachItems: '',
      })

      // Verify parallels are transformed correctly
      expect(result?.parallels['parallel-1']).toEqual({
        id: 'parallel-1',
        nodes: ['block-3'],
        count: 2,
        distribution: ['item1', 'item2'],
        parallelType: 'count',
      })
    })

    it('should return null when no blocks are found', async () => {
      // Mock empty results from all queries
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should return null when database query fails', async () => {
      // Mock database error
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should handle unknown subflow types gracefully', async () => {
      const subflowsWithUnknownType = [
        {
          id: 'unknown-1',
          workflowId: mockWorkflowId,
          type: 'unknown-type',
          config: { id: 'unknown-1' },
        },
      ]

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(mockBlocksFromDb) // blocks query
            if (callCount === 2) return Promise.resolve(mockEdgesFromDb) // edges query
            if (callCount === 3) return Promise.resolve(subflowsWithUnknownType) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      // The function should still return a result but with empty loops and parallels
      expect(result?.loops).toEqual({})
      expect(result?.parallels).toEqual({})
      // Verify blocks and edges are still processed correctly
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
    })

    it('should handle malformed database responses', async () => {
      const malformedBlocks = [
        {
          id: 'block-1',
          workflowId: mockWorkflowId,
          // Missing required fields
          type: null,
          name: null,
          positionX: 0,
          positionY: 0,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(malformedBlocks) // blocks query
            if (callCount === 2) return Promise.resolve([]) // edges query
            if (callCount === 3) return Promise.resolve([]) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.blocks['block-1']).toBeDefined()
      // The function should handle null type and name gracefully
      expect(result?.blocks['block-1'].type).toBeNull()
      expect(result?.blocks['block-1'].name).toBeNull()
    })

    it('should handle database connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused')
        ; (connectionError as any).code = 'ECONNREFUSED'

      // Mock database connection error
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(connectionError),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })
  })

  describe('saveWorkflowToNormalizedTables', () => {
    beforeEach(() => {
      mockNoConflictingBlockIds()
    })

    it('should successfully save workflow data to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) =>
        callback(createMockTx())
      )

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(true)

      // Verify transaction was called
      expect(mockTransaction).toHaveBeenCalledTimes(1)
    })

    it('should handle empty workflow state gracefully', async () => {
      const emptyWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) =>
        callback(createMockTx())
      )

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        emptyWorkflowState
      )

      expect(result.success).toBe(true)
    })

    it('should return error when transaction fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Transaction failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Transaction failed')
    })

    it('should handle database constraint errors', async () => {
      const constraintError = new Error('Unique constraint violation')
        ; (constraintError as any).code = '23505'

      const mockTransaction = vi.fn().mockRejectedValue(constraintError)
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unique constraint violation')
    })

    it('should properly format block data for database insertion', async () => {
      let capturedBlockInserts: any[] = []
      let capturedEdgeInserts: any[] = []
      let capturedSubflowInserts: any[] = []

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = createMockTx({
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((data) => {
              // Capture the data based on which insert call it is
              if (data.length > 0) {
                if (data[0].positionX !== undefined) {
                  capturedBlockInserts = data
                } else if (data[0].sourceBlockId !== undefined) {
                  capturedEdgeInserts = data
                } else if (data[0].type === 'loop' || data[0].type === 'parallel') {
                  capturedSubflowInserts = data
                }
              }
              return Promise.resolve([])
            }),
          }),
        })
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, mockWorkflowState)

      expect(capturedBlockInserts).toHaveLength(2)
      expect(capturedBlockInserts[0]).toMatchObject({
        id: 'block-1',
        workflowId: mockWorkflowId,
        type: 'input_trigger',
        name: 'Start Block',
        positionX: '100',
        positionY: '100',
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: '150',
        advancedMode: false,
        triggerMode: false,
        data: {
          width: 350,
        },
        layout: {},
      })

      expect(capturedEdgeInserts).toHaveLength(1)
      expect(capturedEdgeInserts[0]).toMatchObject({
        id: 'edge-1',
        workflowId: mockWorkflowId,
        sourceBlockId: 'block-1',
        targetBlockId: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(capturedSubflowInserts).toHaveLength(2)
      expect(capturedSubflowInserts[0]).toMatchObject({
        id: 'loop-1',
        workflowId: mockWorkflowId,
        type: 'loop',
      })
    })
  })

  describe('workflowExistsInNormalizedTables', () => {
    it('should return true when workflow exists in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'block-1' }]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(true)
    })

    it('should return false when workflow does not exist in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })

    it('should return false when database query fails', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error')),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })
  })

  describe('migrateWorkflowToNormalizedTables', () => {
    beforeEach(() => {
      mockNoConflictingBlockIds()
    })

    const mockJsonState = {
      blocks: mockWorkflowState.blocks,
      edges: mockWorkflowState.edges,
      loops: mockWorkflowState.loops,
      parallels: mockWorkflowState.parallels,
      lastSaved: Date.now(),
      isDeployed: false,
      deploymentStatuses: {},
    }

    it('should successfully migrate workflow from JSON to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) =>
        callback(createMockTx())
      )

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return error when migration fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Migration failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Migration failed')
    })

    it('should handle missing properties in JSON state gracefully', async () => {
      const incompleteJsonState = {
        blocks: mockWorkflowState.blocks,
        edges: mockWorkflowState.edges,
        // Missing loops, parallels, and other properties
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) =>
        callback(createMockTx())
      )

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        incompleteJsonState
      )

      expect(result.success).toBe(true)
    })

    it('should handle null/undefined JSON state', async () => {
      const result = await dbHelpers.migrateWorkflowToNormalizedTables(mockWorkflowId, null)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot read properties')
    })
  })

  describe('error handling and edge cases', () => {
    beforeEach(() => {
      mockNoConflictingBlockIds()
    })

    it('should handle very large workflow data', async () => {
      const largeWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
      }

      // Create 1000 blocks
      for (let i = 0; i < 1000; i++) {
        largeWorkflowState.blocks[`block-${i}`] = {
          id: `block-${i}`,
          type: 'api',
          name: `Block ${i}`,
          position: { x: i * 100, y: i * 100 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        }
      }

      // Create 999 edges to connect them
      for (let i = 0; i < 999; i++) {
        largeWorkflowState.edges.push({
          id: `edge-${i}`,
          source: `block-${i}`,
          target: `block-${i + 1}`,
        })
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) =>
        callback(createMockTx())
      )

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        largeWorkflowState
      )

      expect(result.success).toBe(true)
    })
  })

  describe('deployWorkflow', () => {
    it('should deploy the persisted Yjs workflow state when no live document is connected', async () => {
      const doc = new Y.Doc()
      const yjsState = {
        blocks: {
          'block-yjs': {
            id: 'block-yjs',
            type: 'api',
            name: 'Persisted block',
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: new Date().toISOString(),
      }
      const yjsVariables = {
        'var-yjs': {
          id: 'var-yjs',
          name: 'Persisted variable',
          type: 'plain',
          value: 'latest',
        },
      }

      setWorkflowState(doc, yjsState, 'test')
      setVariables(doc, yjsVariables, 'test')

      mockGetYjsSnapshot.mockResolvedValue(
        buildWorkflowSnapshotResponse(Y.encodeStateAsUpdate(doc))
      )

      const updateCalls: Array<{ table: unknown; data: Record<string, unknown> }> = []
      const insertCalls: Array<{ table: unknown; data: Record<string, unknown> }> = []
      const workflowLastSaved = new Date('2026-04-06T00:00:00.000Z')
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ maxVersion: 2 }]),
          }),
        }),
        update: vi.fn((table) => ({
          set: vi.fn((data: Record<string, unknown>) => ({
            where: vi.fn().mockImplementation(async () => {
              updateCalls.push({ table, data })
              return []
            }),
          })),
        })),
        insert: vi.fn((table) => ({
          values: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
            insertCalls.push({ table, data })
            return []
          }),
        })),
      }

      mockDb.transaction.mockImplementation(async (callback) => callback(tx))
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                variables: yjsVariables,
                lastSynced: workflowLastSaved,
              },
            ]),
          }),
        }),
      })

      const result = await dbHelpers.deployWorkflow({
        workflowId: mockWorkflowId,
        deployedBy: 'deployer-1',
        workflowOwnerId: 'owner-1',
      })

      expect(result.success).toBe(true)
      expect(mockGetYjsSnapshot).toHaveBeenCalledWith(
        mockWorkflowId,
        expect.objectContaining({
          targetKind: 'workflow',
          sessionId: mockWorkflowId,
          workflowId: mockWorkflowId,
          entityKind: 'workflow',
          entityId: mockWorkflowId,
        })
      )
      expect(mockDb.select).toHaveBeenCalledTimes(1)
      expect(result.currentState).toMatchObject({
        blocks: yjsState.blocks,
        edges: yjsState.edges,
        loops: yjsState.loops,
        parallels: yjsState.parallels,
        variables: yjsVariables,
      })

      const deploymentInsert = insertCalls.find(
        (call) => call.table === mockWorkflowDeploymentVersion
      )
      expect(deploymentInsert?.data.state).toMatchObject({
        blocks: yjsState.blocks,
        variables: yjsVariables,
      })

      const workflowUpdate = updateCalls.find((call) => call.table === mockWorkflowTable)
      expect(workflowUpdate?.data.variables).toEqual(yjsVariables)

      expect(mockReconcilePublishedChatsForDeploymentTx).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: mockWorkflowId,
          workflowOwnerId: 'owner-1',
          state: expect.objectContaining({
            blocks: yjsState.blocks,
            variables: yjsVariables,
          }),
        })
      )
    })
  })

  describe('loadWorkflowStateFromYjs', () => {
    it('should decode the workflow state from the socket-server bridge snapshot', async () => {
      const doc = new Y.Doc()
      const yjsState = {
        blocks: {
          'block-yjs': {
            id: 'block-yjs',
            type: 'api',
            name: 'Live block',
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: new Date().toISOString(),
      }
      const yjsVariables = {
        'var-yjs': {
          id: 'var-yjs',
          name: 'Live variable',
          type: 'plain',
          value: 'latest',
        },
      }

      setWorkflowState(doc, yjsState, 'test')
      setVariables(doc, yjsVariables, 'test')
      mockGetYjsSnapshot.mockResolvedValue(
        buildWorkflowSnapshotResponse(Y.encodeStateAsUpdate(doc))
      )

      const result = await dbHelpers.loadWorkflowStateFromYjs(mockWorkflowId)

      expect(mockGetYjsSnapshot).toHaveBeenCalledWith(
        mockWorkflowId,
        expect.objectContaining({
          targetKind: 'workflow',
          sessionId: mockWorkflowId,
          workflowId: mockWorkflowId,
          entityKind: 'workflow',
          entityId: mockWorkflowId,
        })
      )
      expect(result).toMatchObject({
        blocks: yjsState.blocks,
        edges: yjsState.edges,
        loops: yjsState.loops,
        parallels: yjsState.parallels,
        variables: yjsVariables,
      })
    })
  })

  describe('loadWorkflowStateWithFallback', () => {
    it('returns the Yjs state without a workflow-row query when lastSynced is provided', async () => {
      const doc = new Y.Doc()
      const yjsState = {
        blocks: {
          'block-yjs': {
            id: 'block-yjs',
            type: 'api',
            name: 'Fresh Yjs block',
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: '2026-04-06T00:05:00.000Z',
      }
      const yjsVariables = {
        'var-yjs': {
          id: 'var-yjs',
          name: 'Live variable',
          type: 'plain',
          value: 'latest',
        },
      }

      setWorkflowState(doc, yjsState, 'test')
      setVariables(doc, yjsVariables, 'test')
      mockGetYjsSnapshot.mockResolvedValue(
        buildWorkflowSnapshotResponse(Y.encodeStateAsUpdate(doc))
      )

      const result = await dbHelpers.loadWorkflowStateWithFallback(
        mockWorkflowId,
        new Date('2026-04-06T00:00:00.000Z')
      )

      expect(result).toMatchObject({
        blocks: yjsState.blocks,
        edges: yjsState.edges,
        loops: yjsState.loops,
        parallels: yjsState.parallels,
        variables: yjsVariables,
        source: 'yjs',
      })
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('queries the workflow row for staleness when lastSynced is omitted and the Yjs snapshot is fresh', async () => {
      const doc = new Y.Doc()
      const yjsState = {
        blocks: {
          'block-yjs': {
            id: 'block-yjs',
            type: 'api',
            name: 'Fresh Yjs block',
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: '2026-04-06T00:05:00.000Z',
      }
      const yjsVariables = {
        'var-yjs': {
          id: 'var-yjs',
          name: 'Live variable',
          type: 'plain',
          value: 'latest',
        },
      }

      setWorkflowState(doc, yjsState, 'test')
      setVariables(doc, yjsVariables, 'test')
      mockGetYjsSnapshot.mockResolvedValue(
        buildWorkflowSnapshotResponse(Y.encodeStateAsUpdate(doc))
      )
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                variables: {
                  'var-db': {
                    id: 'var-db',
                    workflowId: mockWorkflowId,
                    name: 'dbVar',
                    type: 'plain',
                    value: 'db value',
                  },
                },
                lastSynced: new Date('2026-04-06T00:00:00.000Z'),
              },
            ]),
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowStateWithFallback(mockWorkflowId)

      expect(result).toMatchObject({
        blocks: yjsState.blocks,
        edges: yjsState.edges,
        loops: yjsState.loops,
        parallels: yjsState.parallels,
        variables: yjsVariables,
        source: 'yjs',
      })
      expect(mockDb.select).toHaveBeenCalledTimes(1)
    })

    it('falls back to normalized tables when the Yjs bridge errors', async () => {
      mockGetYjsSnapshot.mockRejectedValueOnce(
        new Error('socket server unavailable')
      )

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve(mockBlocksFromDb)
            }
            if (callCount === 2) {
              return Promise.resolve(mockEdgesFromDb)
            }
            if (callCount === 3) {
              return Promise.resolve(mockSubflowsFromDb)
            }
            if (callCount === 4) {
              return {
                limit: vi.fn().mockResolvedValue([
                  {
                    variables: {
                      'var-db': {
                        id: 'var-db',
                        workflowId: mockWorkflowId,
                        name: 'dbVar',
                        type: 'plain',
                        value: 'db value',
                      },
                    },
                  },
                ]),
              }
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowStateWithFallback(mockWorkflowId)

      expect(result).toMatchObject({
        blocks: expect.objectContaining({
          'block-1': expect.objectContaining({
            id: 'block-1',
            type: 'input_trigger',
          }),
        }),
        edges: mockEdgesFromDb.map((edge) =>
          expect.objectContaining({
            id: edge.id,
            source: edge.sourceBlockId,
            target: edge.targetBlockId,
          })
        ),
        variables: {
          'var-db': expect.objectContaining({
            id: 'var-db',
            name: 'dbVar',
            value: 'db value',
          }),
        },
        source: 'normalized',
      })
    })

    it('falls back to normalized tables when the stored Yjs snapshot is older than workflow lastSynced', async () => {
      const doc = new Y.Doc()
      setWorkflowState(
        doc,
        {
          blocks: {
            'block-yjs': {
              id: 'block-yjs',
              type: 'api',
              name: 'Stale Yjs block',
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
        },
        'test'
      )
      mockGetYjsSnapshot.mockResolvedValue(
        buildWorkflowSnapshotResponse(Y.encodeStateAsUpdate(doc))
      )

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([
                  {
                    variables: {
                      'var-db': {
                        id: 'var-db',
                        workflowId: mockWorkflowId,
                        name: 'dbVar',
                        type: 'plain',
                        value: 'db value',
                      },
                    },
                    lastSynced: new Date('2026-04-06T00:05:00.000Z'),
                  },
                ]),
              }
            }
            if (callCount === 2) {
              return Promise.resolve(mockBlocksFromDb)
            }
            if (callCount === 3) {
              return Promise.resolve(mockEdgesFromDb)
            }
            if (callCount === 4) {
              return Promise.resolve(mockSubflowsFromDb)
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowStateWithFallback(mockWorkflowId)

      expect(result).toMatchObject({
        blocks: expect.objectContaining({
          'block-1': expect.objectContaining({
            id: 'block-1',
            type: 'input_trigger',
          }),
        }),
        source: 'normalized',
      })
      expect(result?.blocks).not.toHaveProperty('block-yjs')
    })
  })

  describe('advancedMode persistence comparison with isWide', () => {
    it('should load advancedMode property exactly like isWide from database', async () => {
      const testBlocks = [
        {
          id: 'block-advanced-wide',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Advanced Wide Block',
          positionX: 100,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: true,
          advancedMode: true,
          height: 200,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-basic-narrow',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Basic Narrow Block',
          positionX: 200,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          height: 150,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-advanced-narrow',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Advanced Narrow Block',
          positionX: 300,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: true,
          height: 180,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(testBlocks)
            if (callCount === 2) return Promise.resolve([])
            if (callCount === 3) return Promise.resolve([])
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()

      // Test all combinations of isWide and advancedMode
      const advancedWideBlock = result?.blocks['block-advanced-wide']
      expect(advancedWideBlock?.isWide).toBe(true)
      expect(advancedWideBlock?.advancedMode).toBe(true)

      const basicNarrowBlock = result?.blocks['block-basic-narrow']
      expect(basicNarrowBlock?.isWide).toBe(false)
      expect(basicNarrowBlock?.advancedMode).toBe(false)

      const advancedNarrowBlock = result?.blocks['block-advanced-narrow']
      expect(advancedNarrowBlock?.isWide).toBe(false)
      expect(advancedNarrowBlock?.advancedMode).toBe(true)
    })

    it('should handle default values for boolean fields consistently', async () => {
      const blocksWithDefaultValues = [
        {
          id: 'block-with-defaults',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Block with default values',
          positionX: 100,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false, // Database default
          advancedMode: false, // Database default
          triggerMode: false, // Database default
          height: 150,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(blocksWithDefaultValues)
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()

      // All boolean fields should have their database default values
      const defaultsBlock = result?.blocks['block-with-defaults']
      expect(defaultsBlock?.isWide).toBe(false)
      expect(defaultsBlock?.advancedMode).toBe(false)
      expect(defaultsBlock?.triggerMode).toBe(false)
    })
  })

  describe('end-to-end advancedMode persistence verification', () => {
    it('should persist advancedMode through complete duplication and save cycle', async () => {
      // Simulate the exact user workflow:
      // 1. Create a block with advancedMode: true
      // 2. Duplicate the block
      // 3. Save workflow state (this was causing the bug)
      // 4. Reload from database (simulate refresh)
      // 5. Verify advancedMode is still true

      const originalBlock = {
        id: 'agent-original',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Agent 1',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // User sets this to advanced mode
        height: 200,
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'textarea',
            value: 'You are a helpful assistant',
          },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'Help the user' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      const duplicatedBlock = {
        id: 'agent-duplicate',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Agent 2',
        positionX: 200,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // Should be copied from original
        height: 200,
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'textarea',
            value: 'You are a helpful assistant',
          },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'Help the user' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      // Step 1 & 2: Mock loading both original and duplicated blocks from database
      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve([originalBlock, duplicatedBlock])
            if (callCount === 2) return Promise.resolve([]) // edges
            if (callCount === 3) return Promise.resolve([]) // subflows
            return Promise.resolve([])
          }),
        }),
      }))

      // Step 3: Load workflow state (simulates app loading after duplication)
      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['agent-original'].advancedMode).toBe(true)
      expect(loadedState?.blocks['agent-duplicate'].advancedMode).toBe(true)

      // Step 4: Test the critical saveWorkflowToNormalizedTables function
      // This was the function that was dropping advancedMode!
      const workflowState = {
        blocks: loadedState!.blocks,
        edges: loadedState!.edges,
        loops: {},
        parallels: {},
        deploymentStatuses: {},
      }

      // Mock the transaction for save operation
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = createMockTx({
          insert: vi.fn().mockImplementation((_table) => ({
            values: vi.fn().mockImplementation((values) => {
              // Verify that advancedMode is included in the insert values
              if (Array.isArray(values)) {
                values.forEach((blockInsert) => {
                  if (blockInsert.id === 'agent-original') {
                    expect(blockInsert.advancedMode).toBe(true)
                  }
                  if (blockInsert.id === 'agent-duplicate') {
                    expect(blockInsert.advancedMode).toBe(true)
                  }
                })
              }
              return Promise.resolve()
            }),
          })),
        })
        return await callback(mockTx)
      })

      mockDb.transaction = mockTransaction
      mockNoConflictingBlockIds()

      // Step 5: Save workflow state (this should preserve advancedMode)
      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        workflowState
      )
      expect(saveResult.success).toBe(true)

      // Verify the database insert was called with the correct values
      expect(mockTransaction).toHaveBeenCalled()
    })

    it('should handle mixed advancedMode states correctly', async () => {
      // Test scenario: one block in advanced mode, one in basic mode
      const basicBlock = {
        id: 'agent-basic',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Basic Agent',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false, // Basic mode
        height: 150,
        subBlocks: { model: { id: 'model', type: 'select', value: 'gpt-4o' } },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      const advancedBlock = {
        id: 'agent-advanced',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Advanced Agent',
        positionX: 200,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // Advanced mode
        height: 200,
        subBlocks: {
          systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System prompt' },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'User prompt' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve([basicBlock, advancedBlock])
            return Promise.resolve([])
          }),
        }),
      }))

      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()

      // Verify mixed states are preserved
      expect(loadedState?.blocks['agent-basic'].advancedMode).toBe(false)
      expect(loadedState?.blocks['agent-advanced'].advancedMode).toBe(true)

      // Verify other properties are also preserved correctly
      expect(loadedState?.blocks['agent-basic'].isWide).toBe(false)
      expect(loadedState?.blocks['agent-advanced'].isWide).toBe(true)
    })

    it('should preserve advancedMode during workflow state round-trip', async () => {
      // Test the complete round-trip: save to DB → load from DB
      const testWorkflowState = {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'agent',
            name: 'Test Agent',
            position: { x: 100, y: 100 },
            subBlocks: {
              systemPrompt: { id: 'systemPrompt', type: 'long-input' as const, value: 'System' },
              model: { id: 'model', type: 'dropdown' as const, value: 'gpt-4o' },
            },
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            isWide: true,
            advancedMode: true,
            height: 200,
            data: {},
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        deploymentStatuses: {},
      }

      // Mock successful save
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = createMockTx()
        return await callback(mockTx)
      })

      mockDb.transaction = mockTransaction
      mockNoConflictingBlockIds()

      // Save the state
      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        testWorkflowState
      )
      expect(saveResult.success).toBe(true)

      // Mock loading the saved state back
      vi.clearAllMocks()
      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve([
                {
                  id: 'block-1',
                  workflowId: mockWorkflowId,
                  type: 'agent',
                  name: 'Test Agent',
                  positionX: 100,
                  positionY: 100,
                  enabled: true,
                  horizontalHandles: true,
                  isWide: true,
                  advancedMode: true, // This should be preserved
                  height: 200,
                  subBlocks: {
                    systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System' },
                    model: { id: 'model', type: 'select', value: 'gpt-4o' },
                  },
                  outputs: {},
                  data: {},
                  parentId: null,
                  extent: null,
                },
              ])
            }
            return Promise.resolve([])
          }),
        }),
      }))

      // Load the state back
      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['block-1'].advancedMode).toBe(true)
      expect(loadedState?.blocks['block-1'].isWide).toBe(true)
    })
  })
})
