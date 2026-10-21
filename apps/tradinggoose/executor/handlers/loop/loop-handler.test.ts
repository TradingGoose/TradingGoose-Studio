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
      ['for', '', [0], ''],
      ['for', '', [0, 1, 2], ''],
      ['forEach', '', [0], '["single"]'],
      ['forEach', '', [0, 1, 2], '["a","b","c"]'],
      ['forEach', '', [0, 1], '{"a":1,"b":2}'],
      ['while', '<loop.index> < 3', [0, 1, 2], ''],
      ['doWhile', '<loop.index> < 3', [0, 1, 2], ''],
      ['while', 'false', [], ''],
      ['doWhile', 'false', [0], ''],
    ] as const)(
      'executes %s with complete iteration outputs (case %#)',
      async (loopType, condition, expected, collection) => {
        const workflow = mockContext.workflow!
        const aggregatesResults = loopType === 'for' || loopType === 'forEach'
        workflow.loops[mockBlock.id] = {
          ...workflow.loops[mockBlock.id],
          loopType,
          iterations: loopType === 'for' ? expected.length : 0,
          forEachItems: collection,
          whileCondition: condition,
        }
        mockBlock.config.params = {
          loopType,
          iterations: workflow.loops[mockBlock.id].iterations,
          forEachItems: collection,
          whileCondition: condition,
        }
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
            config: {
              tool: 'response',
              params: {
                dataMode: 'json',
                data: aggregatesResults
                  ? '{"done":true,"results":<testloop.results>}'
                  : '{"done":true}',
              },
            },
          }
        )
        workflow.connections.unshift({ source: 'trigger', target: mockBlock.id })
        const result = await new Executor({
          workflow,
          contextExtensions: { workspaceId: 'test-workspace-id' },
        }).execute('test-workflow', 'trigger')

        expect(result.success).toBe(true)
        const bodyLogs = result.logs!.filter((log) => log.blockId === 'inner-block')
        expect(bodyLogs.map((log) => log.output?.response?.data.index)).toEqual(expected)
        expect(result.output.response?.data.done).toBe(true)
        if (aggregatesResults) {
          expect(result.output.response?.data.results).toEqual(bodyLogs.map((log) => log.output))
        }
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
      mockContext.blockStates.set('loop-1', {
        output: await handler.execute(mockBlock, {}, mockContext),
        executed: true,
        executionTime: 0,
      })
      mockContext.loopIterations.set('loop-1', 4)

      const result = await handler.execute(mockBlock, {}, mockContext)

      expect(mockContext.completedLoops.has('loop-1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('after-loop')).toBe(true)
      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(false)
      expect(result).toMatchObject({
        completed: true,
        currentIteration: 2,
        maxIterations: 3,
        results: [],
      })
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

    it('finishes forEach at the last evaluated collection bound', async () => {
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

      expect(result).toMatchObject({ maxIterations: 2, completed: false })

      mockContext.loopIterations.set('loop-1', 2)

      result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.loopIterations.get('loop-1')).toBe(2)
      expect(mockContext.loopItems.get('loop-1')).toBe('b')

      expect(result).toMatchObject({ completed: false })
      mockContext.blockStates.set('loop-1', {
        output: result,
        executed: true,
        executionTime: 0,
      })
      mockContext.workflow!.loops['loop-1'].forEachItems = []
      mockContext.loopExecutions = new Map([
        [
          'loop-1',
          new Map([
            ['iteration_1', { result: 'b' }],
            ['iteration_0', { result: 'a' }],
          ]),
        ],
      ])
      mockContext.loopIterations.set('loop-1', 3)

      result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)
      expect(result).toMatchObject({
        completed: true,
        currentIteration: 1,
        maxIterations: 2,
        results: [{ result: 'a' }, { result: 'b' }],
      })
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
