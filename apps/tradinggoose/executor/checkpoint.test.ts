import { describe, expect, it, vi } from 'vitest'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { restoreExecutionContext, saveExecutionContext } from '@/executor/checkpoint'
import type { ExecutionContext } from '@/executor/types'

describe('Executor checkpoint JSON round trip', () => {
  it('restores routing, loop, parallel, variable and block state without runtime callbacks', () => {
    const context: ExecutionContext = {
      ...createMockContext(),
      userId: 'actor',
      executionId: 'execution',
      triggerBlockId: 'trigger',
      environmentVariables: { SECRET: 'encrypted with the checkpoint' },
      workflowVariables: { counter: { name: 'counter', type: 'number', value: 3 } },
      blockStates: new Map([
        ['upstream', { output: { value: 9 }, executed: true, executionTime: 1 }],
      ]),
      decisions: {
        router: new Map([['router', 'yes']]),
        condition: new Map([['condition', 'true']]),
      },
      loopIterations: new Map([['loop', 2]]),
      loopItems: new Map([['loop', { currentItem: 'second', index: 1 }]]),
      executedBlocks: new Set(['upstream']),
      activeExecutionPath: new Set(['approval']),
      completedLoops: new Set(['previous-loop']),
      loopExecutions: new Map([
        [
          'loop',
          {
            maxIterations: 3,
            loopType: 'for',
            currentIteration: 2,
            executionResults: new Map([['0', { result: 'first' }]]),
          },
        ],
      ]),
      parallelExecutions: new Map([
        [
          'parallel',
          {
            parallelCount: 2,
            distributionItems: ['a', 'b'],
            completedExecutions: 1,
            executionResults: new Map([['0', { approved: true }]]),
            activeIterations: new Set([1]),
            currentIteration: 1,
            parallelType: 'collection',
          },
        ],
      ]),
      parallelBlockMapping: new Map([
        [
          'approval_parallel_parallel_iteration_1',
          {
            originalBlockId: 'approval',
            parallelId: 'parallel',
            iterationIndex: 1,
          },
        ],
      ]),
      onExecutionEvent: vi.fn(),
      shouldCancelExecution: vi.fn(),
      pausePoints: [],
      resumeInputs: new Map([['approval', { approved: true }]]),
    }
    context.metadata.context = context
    const saved = saveExecutionContext(context)
    expect(saved).not.toHaveProperty('workflow')
    expect(saved).not.toHaveProperty('onExecutionEvent')
    expect(saved).not.toHaveProperty('shouldCancelExecution')
    expect(saved).not.toHaveProperty('resumeInputs')
    expect(saved.metadata).not.toHaveProperty('context')
    const restored = restoreExecutionContext(JSON.parse(JSON.stringify(saved)))
    for (const key of [
      'blockStates',
      'decisions',
      'loopIterations',
      'loopItems',
      'executedBlocks',
      'activeExecutionPath',
      'completedLoops',
      'loopExecutions',
      'parallelExecutions',
      'parallelBlockMapping',
      'workflowVariables',
      'environmentVariables',
    ] as const) {
      expect(restored[key]).toEqual(context[key])
    }
    expect(restored.pausePoints).toEqual([])
    expect(restored.resumeInputs).toEqual(new Map())
    expect(restored.userId).toBe('actor')
    expect(restored.executionId).toBe('execution')
  })
})
