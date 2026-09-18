import { vi } from 'vitest'
import type { SerializedWorkflow } from '@/serializer/types'

/**
 * Mock handler factory - creates consistent handler mocks
 */
export const createMockHandler = (
  handlerName: string,
  options?: {
    canHandleCondition?: (block: any) => boolean
    executeResult?: any | ((inputs: any) => any)
  }
) => {
  const defaultCanHandle = (block: any) =>
    block.metadata?.id === handlerName || handlerName === 'generic'

  const defaultExecuteResult = {
    result: `${handlerName} executed`,
  }

  return vi.fn().mockImplementation(() => ({
    canHandle: options?.canHandleCondition || defaultCanHandle,
    execute: vi.fn().mockImplementation(async (block, inputs) => {
      if (typeof options?.executeResult === 'function') {
        return options.executeResult(inputs)
      }
      return options?.executeResult || defaultExecuteResult
    }),
  }))
}

/**
 * Setup all handler mocks with default behaviors
 */
export const setupHandlerMocks = () => {
  vi.doMock('@/executor/handlers', () => ({
    TriggerBlockHandler: createMockHandler('trigger', {
      canHandleCondition: (block) =>
        block.metadata?.category === 'triggers' || block.config?.params?.triggerMode === true,
      executeResult: (inputs: any) => inputs || {},
    }),
    AgentBlockHandler: createMockHandler('agent'),
    RouterBlockHandler: createMockHandler('router'),
    ConditionBlockHandler: createMockHandler('condition'),
    EvaluatorBlockHandler: createMockHandler('evaluator'),
    FunctionBlockHandler: createMockHandler('function'),
    ApiBlockHandler: createMockHandler('api'),
    LoopBlockHandler: createMockHandler('loop'),
    ParallelBlockHandler: createMockHandler('parallel'),
    WorkflowBlockHandler: createMockHandler('workflow_input'),
    VariablesBlockHandler: createMockHandler('variables'),
    WaitBlockHandler: createMockHandler('wait'),
    GenericBlockHandler: createMockHandler('generic'),
    ResponseBlockHandler: createMockHandler('response'),
  }))
}

/**
 * Setup core executor mocks (PathTracker, InputResolver, LoopManager, ParallelManager)
 */
export const setupExecutorCoreMocks = () => {
  vi.doMock('@/executor/path', () => ({
    PathTracker: vi.fn().mockImplementation(() => ({
      updateExecutionPaths: vi.fn(),
      isInActivePath: vi.fn().mockReturnValue(true),
    })),
  }))

  vi.doMock('@/executor/resolver', () => ({
    InputResolver: vi.fn().mockImplementation(() => ({
      resolveInputs: vi.fn().mockReturnValue({}),
      resolveBlockReferences: vi.fn().mockImplementation((value) => value),
      resolveVariableReferences: vi.fn().mockImplementation((value) => value),
      resolveEnvVariables: vi.fn().mockImplementation((value) => value),
    })),
  }))

  vi.doMock('@/executor/loops', () => ({
    LoopManager: vi.fn().mockImplementation(() => ({
      processLoopIterations: vi.fn().mockResolvedValue(false),
      getLoopIndex: vi.fn().mockImplementation((loopId, blockId, context) => {
        return context.loopIterations?.get(loopId) || 0
      }),
    })),
  }))

  vi.doMock('@/executor/parallels', () => ({
    ParallelManager: vi.fn().mockImplementation(() => ({
      processParallelIterations: vi.fn().mockResolvedValue(false),
      createVirtualBlockInstances: vi.fn().mockReturnValue([]),
      setupIterationContext: vi.fn(),
      storeIterationResult: vi.fn(),
      initializeParallel: vi.fn(),
      getIterationItem: vi.fn(),
      areAllVirtualBlocksExecuted: vi.fn().mockReturnValue(false),
    })),
  }))
}

/**
 * Workflow factory functions
 */
export const createMinimalWorkflow = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'trigger',
      position: { x: 0, y: 0 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'input_trigger', name: 'Input Trigger', category: 'triggers' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Test Block' },
    },
  ],
  connections: [
    {
      source: 'trigger',
      target: 'block1',
    },
  ],
  loops: {},
})

export const createWorkflowWithCondition = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'trigger',
      position: { x: 0, y: 0 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'input_trigger', name: 'Input Trigger', category: 'triggers' },
    },
    {
      id: 'condition1',
      position: { x: 100, y: 0 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'condition', name: 'Condition Block' },
    },
    {
      id: 'block1',
      position: { x: 200, y: -50 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'True Path Block' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 50 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'False Path Block' },
    },
  ],
  connections: [
    {
      source: 'trigger',
      target: 'condition1',
    },
    {
      source: 'condition1',
      target: 'block1',
      sourceHandle: 'condition-true',
    },
    {
      source: 'condition1',
      target: 'block2',
      sourceHandle: 'condition-false',
    },
  ],
  loops: {},
})

export const createWorkflowWithLoop = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'trigger',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'input_trigger', name: 'Input Trigger', category: 'triggers' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'input_trigger', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 1' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 2' },
    },
  ],
  connections: [
    {
      source: 'trigger',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'block2',
    },
    {
      source: 'block2',
      target: 'block1',
    },
  ],
  loops: {
    loop1: {
      id: 'loop1',
      nodes: ['block1', 'block2'],
      iterations: 5,
      loopType: 'forEach',
      forEachItems: [1, 2, 3, 4, 5],
    },
  },
})

export const createWorkflowWithErrorPath = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'trigger',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'input_trigger', name: 'Input Trigger', category: 'triggers' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'function', name: 'Function Block' },
    },
    {
      id: 'error-handler',
      position: { x: 200, y: 50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Error Handler Block' },
    },
    {
      id: 'success-block',
      position: { x: 200, y: -50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Success Block' },
    },
  ],
  connections: [
    {
      source: 'trigger',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'success-block',
      sourceHandle: 'source',
    },
    {
      source: 'block1',
      target: 'error-handler',
      sourceHandle: 'error',
    },
  ],
  loops: {},
})

/**
 * Create a mock execution context with customizable options
 */
export interface MockContextOptions {
  workflowId?: string
  workspaceId?: string
  loopIterations?: Map<string, number>
  loopItems?: Map<string, any>
  executedBlocks?: Set<string>
  activeExecutionPath?: Set<string>
  completedLoops?: Set<string>
  parallelExecutions?: Map<string, any>
  parallelBlockMapping?: Map<string, any>
  currentVirtualBlockId?: string
  workflow?: SerializedWorkflow
  blockStates?: Map<string, any>
}

export const createMockContext = (options: MockContextOptions = {}) => {
  const workflow = options.workflow || createMinimalWorkflow()

  return {
    workflowId: options.workflowId || 'test-workflow-id',
    workspaceId: options.workspaceId || 'test-workspace-id',
    blockStates: options.blockStates || new Map(),
    blockLogs: [],
    metadata: { startTime: new Date().toISOString(), duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopIterations: options.loopIterations || new Map(),
    loopItems: options.loopItems || new Map(),
    executedBlocks: options.executedBlocks || new Set<string>(),
    activeExecutionPath: options.activeExecutionPath || new Set<string>(),
    workflow,
    completedLoops: options.completedLoops || new Set<string>(),
    parallelExecutions: options.parallelExecutions,
    parallelBlockMapping: options.parallelBlockMapping,
    currentVirtualBlockId: options.currentVirtualBlockId,
  }
}

/**
 * Create a parallel execution state object for testing
 */
export const createParallelExecutionState = (options?: {
  parallelCount?: number
  distributionItems?: any[] | Record<string, any> | null
  completedExecutions?: number
  executionResults?: Map<string, any>
  activeIterations?: Set<number>
  currentIteration?: number
  parallelType?: 'count' | 'collection'
}) => ({
  parallelCount: options?.parallelCount ?? 3,
  distributionItems:
    options?.distributionItems !== undefined ? options.distributionItems : ['a', 'b', 'c'],
  completedExecutions: options?.completedExecutions ?? 0,
  executionResults: options?.executionResults ?? new Map<string, any>(),
  activeIterations: options?.activeIterations ?? new Set<number>(),
  currentIteration: options?.currentIteration ?? 1,
  parallelType: options?.parallelType,
})

/**
 * Sets up all standard mocks for executor tests
 */
export const setupAllMocks = () => {
  setupHandlerMocks()
  setupExecutorCoreMocks()
}
