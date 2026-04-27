import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowExecutionBlueprint } from './execution-runner'
import { loadWorkflowExecutionBlueprint, runPreparedWorkflowExecution } from './execution-runner'

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const setupExecutor = vi.fn()
  const safeStart = vi.fn()
  const safeComplete = vi.fn()
  const safeCompleteWithError = vi.fn()
  const dbRowsQueue: unknown[][] = []
  const dbChain: Record<string, any> = {}
  dbChain.from = vi.fn(() => dbChain)
  dbChain.where = vi.fn(() => dbChain)
  dbChain.limit = vi.fn(() => Promise.resolve(dbRowsQueue.shift() ?? []))
  const executionConcurrencyController = {
    runWithoutLease: vi.fn((task: () => unknown) => task()),
  }

  return {
    execute,
    setupExecutor,
    safeStart,
    safeComplete,
    safeCompleteWithError,
    dbRowsQueue,
    executionConcurrencyController,
    dbSelect: vi.fn(() => dbChain),
    executorConstructor: vi.fn(),
    loggingSessionConstructor: vi.fn(),
    updateWorkflowRunCounts: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.dbSelect } }))
vi.mock('@tradinggoose/db/schema', () => ({ workflow: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: vi.fn().mockResolvedValue({ isExceeded: false }),
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: vi.fn().mockResolvedValue({
    personalEncrypted: {},
    workspaceEncrypted: {},
  }),
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  withExecutionConcurrencyController: vi.fn(({ task }) =>
    task(mocks.executionConcurrencyController)
  ),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation((...args) => {
    mocks.loggingSessionConstructor(...args)
    return {
      safeStart: mocks.safeStart,
      setupExecutor: mocks.setupExecutor,
      safeComplete: mocks.safeComplete,
      safeCompleteWithError: mocks.safeCompleteWithError,
    }
  }),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 12 }),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: vi.fn(),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadDeployedWorkflowState: vi.fn(),
  loadWorkflowFromNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/triggers', () => ({
  TriggerUtils: {
    findStartBlock: vi.fn(),
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  updateWorkflowRunCounts: mocks.updateWorkflowRunCounts,
}))

vi.mock('@/lib/workflows/variable-utils', () => ({
  normalizeVariables: vi.fn().mockReturnValue({}),
}))

vi.mock('@/serializer', () => ({
  Serializer: vi.fn().mockImplementation(() => ({
    serializeWorkflow: vi.fn((_blocks, edges, loops, parallels) => ({
      connections: edges,
      loops,
      parallels,
    })),
  })),
}))

vi.mock('@/stores/workflows/server-utils', () => ({
  mergeSubblockState: vi.fn((blocks) => blocks),
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation((options) => {
    mocks.executorConstructor(options)
    return {
      execute: mocks.execute,
    }
  }),
}))

const blueprint: WorkflowExecutionBlueprint = {
  workflowId: 'workflow-1',
  executionTarget: 'deployed',
  workflowContext: {
    workspaceId: 'workspace-1',
    variables: {},
  },
  workflowData: {
    blocks: {
      trigger: {
        subBlocks: {},
      },
    },
    edges: [{ source: 'trigger', target: 'worker' }],
    loops: {},
    parallels: {},
  },
}

describe('runPreparedWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dbRowsQueue.length = 0
    mocks.safeStart.mockResolvedValue('workflow-log-1')
    mocks.execute.mockResolvedValue({
      success: true,
      output: { result: 'ok' },
      logs: [],
    })
  })

  it('threads required workspace and workflow log context into executor runs', async () => {
    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'webhook',
      workflowInput: { symbol: 'AAPL' },
      executionId: 'execution-1',
      start: {
        kind: 'block',
        blockId: 'trigger',
      },
      contextExtensions: {
        workspaceId: 'spoofed-workspace',
        workflowLogId: 'spoofed-log',
        submissionSource: 'manual',
      },
    })

    expect(mocks.loggingSessionConstructor).toHaveBeenCalledWith(
      'workflow-1',
      'execution-1',
      'webhook',
      'executio'
    )
    expect(mocks.safeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    )
    expect(mocks.executorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        contextExtensions: expect.objectContaining({
          executionId: 'execution-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          workflowLogId: 'workflow-log-1',
          submissionSource: 'workflow',
          concurrencyLeaseInherited: true,
          executionConcurrencyController: mocks.executionConcurrencyController,
          triggerType: 'webhook',
          workflowDepth: 0,
          isDeployedContext: true,
        }),
      })
    )
    expect(mocks.setupExecutor).toHaveBeenCalled()
    expect(mocks.safeComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 12,
        finalOutput: { result: 'ok' },
        workflowInput: { symbol: 'AAPL' },
      })
    )
  })
})

describe('loadWorkflowExecutionBlueprint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dbRowsQueue.length = 0
  })

  it('resolves required workspace scope before loading workflow state', async () => {
    const { loadDeployedWorkflowState } = await import('@/lib/workflows/db-helpers')

    await expect(loadWorkflowExecutionBlueprint({ workflowId: 'workflow-1' })).rejects.toThrow(
      'Workflow workflow-1 is missing workspace scope'
    )

    expect(loadDeployedWorkflowState).not.toHaveBeenCalled()
  })
})
