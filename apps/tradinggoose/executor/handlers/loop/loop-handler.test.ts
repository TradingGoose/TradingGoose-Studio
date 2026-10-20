import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Executor } from '@/executor'
import { BlockType } from '@/executor/consts'
import { LoopBlockHandler } from '@/executor/handlers/loop/loop-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

describe('LoopBlockHandler', () => {
  let handler: LoopBlockHandler
  let mockContext: ExecutionContext
  let mockBlock: SerializedBlock

  const mockPathTracker = {
    isInActivePath: vi.fn(),
  }

  beforeEach(() => {
    handler = new LoopBlockHandler()

    mockBlock = {
      id: 'loop-1',
      position: { x: 0, y: 0 },
      config: { tool: BlockType.LOOP, params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: BlockType.LOOP, name: 'Test Loop' },
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow',
      workspaceId: 'test-workspace-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: {
        version: '1.0',
        blocks: [mockBlock],
        connections: [
          {
            source: 'loop-1',
            target: 'inner-block',
            sourceHandle: 'loop-start-source',
          },
          {
            source: 'loop-1',
            target: 'after-loop',
            sourceHandle: 'loop-end-source',
          },
        ],
        loops: {
          'loop-1': {
            id: 'loop-1',
            nodes: ['inner-block'],
            iterations: 3,
            loopType: 'for',
          },
        },
      },
    }
  })

  describe('canHandle', () => {
    it('should handle loop blocks', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should not handle non-loop blocks', () => {
      if (mockBlock.metadata) {
        mockBlock.metadata.id = BlockType.FUNCTION
      }
      expect(handler.canHandle(mockBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it.each([
      ['while', '<loop.index> < 3', [0, 1, 2]],
      ['doWhile', '<loop.index> < 3', [0, 1, 2]],
      ['while', 'false', []],
      ['doWhile', 'false', [0]],
    ] as const)(
      'executes %s condition %s with the current body index',
      async (loopType, condition, expected) => {
        const workflow = mockContext.workflow!
        workflow.loops[mockBlock.id] = {
          ...workflow.loops[mockBlock.id],
          loopType,
          whileCondition: condition,
        }
        mockBlock.config.params = { loopType, whileCondition: condition }
        workflow.blocks.push(
          {
            ...mockBlock,
            id: 'trigger',
            metadata: { id: 'input_trigger', name: 'Start', category: 'triggers' },
            config: { tool: 'input_trigger', params: {} },
          },
          {
            ...mockBlock,
            id: 'inner-block',
            metadata: { id: BlockType.RESPONSE, name: 'Body' },
            config: {
              tool: 'response',
              params: { dataMode: 'json', data: '{"index":<loop.index>}' },
            },
          },
          {
            ...mockBlock,
            id: 'after-loop',
            metadata: { id: BlockType.RESPONSE, name: 'After' },
            config: { tool: 'response', params: { dataMode: 'json', data: '{"done":true}' } },
          }
        )
        workflow.connections.unshift({ source: 'trigger', target: mockBlock.id })
        const result = await new Executor({
          workflow,
          contextExtensions: { workspaceId: 'test-workspace-id' },
        }).execute('test-workflow', 'trigger')

        expect(result.success).toBe(true)
        expect(
          result.logs
            ?.filter((log) => log.blockId === 'inner-block')
            .map((log) => log.output?.response?.data.index)
        ).toEqual(expected)
        expect(result.output.response?.data.done).toBe(true)
      }
    )

    it('should initialize loop on first execution', async () => {
      const result = await handler.execute(mockBlock, {}, mockContext)

      expect(mockContext.loopIterations.get('loop-1')).toBe(1)
      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(true)

      if (typeof result === 'object' && result !== null) {
        const response = result as any
        expect(response.currentIteration).toBe(1)
        expect(response.maxIterations).toBe(3)
        expect(response.completed).toBe(false)
      }
    })

    it('should activate loop-end-source when iterations complete', async () => {
      mockContext.loopIterations.set('loop-1', 4)

      const result = await handler.execute(mockBlock, {}, mockContext)

      expect(mockContext.completedLoops.has('loop-1')).toBe(false)
      expect(mockContext.activeExecutionPath.has('after-loop')).toBe(false)
      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(false)

      if (typeof result === 'object' && result !== null) {
        const response = result as any
        expect(response.completed).toBe(false)
        expect(response.message).toContain('Final iteration')
      }
    })

    it('should handle forEach loops with array items', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10,
        loopType: 'forEach',
        forEachItems: ['item1', 'item2', 'item3'],
      }

      const result = await handler.execute(mockBlock, {}, mockContext)

      expect(mockContext.loopItems.get('loop-1')).toBe('item1')

      if (typeof result === 'object' && result !== null) {
        const response = result as any
        expect(response.loopType).toBe('forEach')
        expect(response.maxIterations).toBe(3)
      }
    })

    it('should handle forEach loops with object items', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10,
        loopType: 'forEach',
        forEachItems: { key1: 'value1', key2: 'value2' },
      }

      await handler.execute(mockBlock, {}, mockContext)

      const currentItem = mockContext.loopItems.get('loop-1')
      expect(Array.isArray(currentItem)).toBe(true)
      expect((currentItem as any)[0]).toBe('key1')
      expect((currentItem as any)[1]).toBe('value1')
    })

    it('should limit forEach loops by collection size, not iterations parameter', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10,
        loopType: 'forEach',
        forEachItems: ['a', 'b'],
      }

      let result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.loopIterations.get('loop-1')).toBe(1)
      expect(mockContext.loopItems.get('loop-1')).toBe('a')

      if (typeof result === 'object' && result !== null) {
        const response = result as any
        expect(response.maxIterations).toBe(2)
        expect(response.completed).toBe(false)
      }

      mockContext.loopIterations.set('loop-1', 2)

      result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.loopIterations.get('loop-1')).toBe(2)
      expect(mockContext.loopItems.get('loop-1')).toBe('b')

      if (typeof result === 'object' && result !== null) {
        const response = result as any
        expect(response.completed).toBe(false)
      }

      // Manually increment iteration for third execution (exceeds max)
      mockContext.loopIterations.set('loop-1', 3)

      // Third execution should exceed the loop limit
      result = await handler.execute(mockBlock, {}, mockContext)
      // The loop handler no longer marks loops as completed - that's handled by the loop manager
      expect(mockContext.completedLoops.has('loop-1')).toBe(false)
    })

    it('should throw error for forEach loops without collection', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 5,
        loopType: 'forEach',
        forEachItems: '',
      }

      await expect(handler.execute(mockBlock, {}, mockContext)).rejects.toThrow(
        'forEach loop "loop-1" requires a collection to iterate over'
      )
    })

    it('should throw error for forEach loops with empty collection', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 5,
        loopType: 'forEach',
        forEachItems: [],
      }

      await expect(handler.execute(mockBlock, {}, mockContext)).rejects.toThrow(
        'forEach loop "loop-1" collection is empty or invalid'
      )
    })
  })

  describe('PathTracker integration', () => {
    it('should activate children when in active path', async () => {
      const handlerWithPathTracker = new LoopBlockHandler(undefined, mockPathTracker as any)

      mockPathTracker.isInActivePath.mockReturnValue(true)

      await handlerWithPathTracker.execute(mockBlock, {}, mockContext)

      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(true)
      expect(mockPathTracker.isInActivePath).toHaveBeenCalledWith('loop-1', mockContext)
    })

    it('should not activate children when not in active path', async () => {
      const handlerWithPathTracker = new LoopBlockHandler(undefined, mockPathTracker as any)

      mockPathTracker.isInActivePath.mockReturnValue(false)

      await handlerWithPathTracker.execute(mockBlock, {}, mockContext)

      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(false)
      expect(mockPathTracker.isInActivePath).toHaveBeenCalledWith('loop-1', mockContext)
    })

    it('should handle PathTracker errors gracefully', async () => {
      const handlerWithPathTracker = new LoopBlockHandler(undefined, mockPathTracker as any)

      mockPathTracker.isInActivePath.mockImplementation(() => {
        throw new Error('PathTracker error')
      })

      await handlerWithPathTracker.execute(mockBlock, {}, mockContext)

      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(true)
    })
  })
})
