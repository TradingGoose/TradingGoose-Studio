import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SnapshotService } from '@/lib/logs/execution/snapshot/service'
import type { WorkflowState } from '@/lib/logs/types'

const { mockDelete, mockDeleteWhere, mockDeleteReturning } = vi.hoisted(() => {
  const mockDeleteReturning = vi.fn()
  const mockDeleteWhere = vi.fn(() => ({
    returning: mockDeleteReturning,
  }))
  const mockDelete = vi.fn(() => ({
    where: mockDeleteWhere,
  }))

  return {
    mockDelete,
    mockDeleteWhere,
    mockDeleteReturning,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    delete: mockDelete,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    stateSnapshotId: 'workflowExecutionLogs.stateSnapshotId',
  },
  workflowExecutionSnapshots: {
    id: 'workflowExecutionSnapshots.id',
    workflowId: 'workflowExecutionSnapshots.workflowId',
    workspaceId: 'workflowExecutionSnapshots.workspaceId',
    stateHash: 'workflowExecutionSnapshots.stateHash',
    createdAt: 'workflowExecutionSnapshots.createdAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lt', value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })),
}))

describe('SnapshotService', () => {
  let service: SnapshotService

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteReturning.mockResolvedValue([{ id: 'snapshot-1' }, { id: 'snapshot-2' }])
    service = new SnapshotService()
  })

  describe('computeStateHash', () => {
    test('should generate consistent hashes for identical states', () => {
      const state: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {},
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            advancedMode: false,
            height: 0,
          },
        },
        edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
        loops: {},
        parallels: {},
      }

      const hash1 = service.computeStateHash(state)
      const hash2 = service.computeStateHash(state)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex string
    })

    test('should ignore position changes', () => {
      const baseState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {},
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            advancedMode: false,
            height: 0,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      }

      const stateWithDifferentPosition: WorkflowState = {
        ...baseState,
        blocks: {
          block1: {
            ...baseState.blocks.block1,
            position: { x: 500, y: 600 }, // Different position
          },
        },
      }

      const hash1 = service.computeStateHash(baseState)
      const hash2 = service.computeStateHash(stateWithDifferentPosition)

      expect(hash1).toBe(hash2)
    })

    test('should detect meaningful changes', () => {
      const baseState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {},
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            advancedMode: false,
            height: 0,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      }

      const stateWithDifferentPrompt: WorkflowState = {
        ...baseState,
        blocks: {
          block1: {
            ...baseState.blocks.block1,
            // Different block state - we can change outputs to make it different
            outputs: { response: { content: 'different result' } as Record<string, any> },
          },
        },
      }

      const hash1 = service.computeStateHash(baseState)
      const hash2 = service.computeStateHash(stateWithDifferentPrompt)

      expect(hash1).not.toBe(hash2)
    })

    test('should handle edge order consistently', () => {
      const state1: WorkflowState = {
        blocks: {},
        edges: [
          { id: 'edge1', source: 'a', target: 'b' },
          { id: 'edge2', source: 'b', target: 'c' },
        ],
        loops: {},
        parallels: {},
      }

      const state2: WorkflowState = {
        blocks: {},
        edges: [
          { id: 'edge2', source: 'b', target: 'c' }, // Different order
          { id: 'edge1', source: 'a', target: 'b' },
        ],
        loops: {},
        parallels: {},
      }

      const hash1 = service.computeStateHash(state1)
      const hash2 = service.computeStateHash(state2)

      expect(hash1).toBe(hash2) // Should be same despite different order
    })

    test('should handle empty states', () => {
      const emptyState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      }

      const hash = service.computeStateHash(emptyState)
      expect(hash).toHaveLength(64)
    })

    test('should handle complex nested structures', () => {
      const complexState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Complex Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {
              prompt: {
                id: 'prompt',
                type: 'short-input',
                value: 'Test prompt',
              },
              model: {
                id: 'model',
                type: 'short-input',
                value: 'gpt-4',
              },
            },
            outputs: {
              response: { content: 'Agent response' } as Record<string, any>,
            },
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            advancedMode: true,
            height: 200,
          },
        },
        edges: [{ id: 'edge1', source: 'block1', target: 'block2', sourceHandle: 'output' }],
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            iterations: 10,
            loopType: 'for',
          },
        },
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            count: 3,
            parallelType: 'count',
          },
        },
      }

      const hash = service.computeStateHash(complexState)
      expect(hash).toHaveLength(64)

      // Should be consistent
      const hash2 = service.computeStateHash(complexState)
      expect(hash).toBe(hash2)
    })
  })

  describe('cleanupOrphanedSnapshots', () => {
    test('does not delete snapshots still referenced by workflow logs', async () => {
      const deletedCount = await service.cleanupOrphanedSnapshots(30)

      expect(deletedCount).toBe(2)
      expect(mockDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'workflowExecutionSnapshots.id',
        })
      )

      const whereCondition = (mockDeleteWhere.mock.calls as unknown as Array<[unknown]>).at(
        -1
      )?.[0] as { conditions?: Array<Record<string, any>> } | undefined
      const conditions = whereCondition?.conditions ?? []

      expect(conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'workflowExecutionSnapshots.createdAt',
            type: 'lt',
          }),
        ])
      )
      expect(
        conditions.some(
          (condition) =>
            condition.type === 'sql' &&
            condition.strings?.join('').includes('NOT EXISTS') &&
            condition.values?.includes('workflowExecutionLogs.stateSnapshotId') &&
            condition.values?.includes('workflowExecutionSnapshots.id')
        )
      ).toBe(true)
    })
  })
})
