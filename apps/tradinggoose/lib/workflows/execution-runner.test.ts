import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerUtils } from '@/lib/workflows/triggers'
import type { WorkflowExecutionBlueprint } from './execution-runner'
import { loadWorkflowExecutionBlueprint, runPreparedWorkflowExecution } from './execution-runner'

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const start = vi.fn()
  const complete = vi.fn()
  const completeWithError = vi.fn()
  const checkServerSideUsageLimits = vi.fn()
  const decryptSecret = vi.fn()
  const getPersonalAndWorkspaceEnv = vi.fn()
  const dbRowsQueue: unknown[][] = []
  const dbChain: Record<string, any> = {}
  dbChain.from = vi.fn(() => dbChain)
  dbChain.where = vi.fn(() => dbChain)
  dbChain.limit = vi.fn(() => Promise.resolve(dbRowsQueue.shift() ?? []))
  return {
    execute,
    start,
    complete,
    completeWithError,
    checkServerSideUsageLimits,
    dbRowsQueue,
    dbSelect: vi.fn(() => dbChain),
    decryptSecret,
    executorConstructor: vi.fn(),
    getPersonalAndWorkspaceEnv,
    loggingSessionConstructor: vi.fn(),
    updateWorkflowRunCounts: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.dbSelect } }))
vi.mock('@tradinggoose/db/schema', () => ({ workflow: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: mocks.checkServerSideUsageLimits,
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mocks.getPersonalAndWorkspaceEnv,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation((...args) => {
    mocks.loggingSessionConstructor(...args)
    return {
      start: mocks.start,
      complete: mocks.complete,
      completeWithError: mocks.completeWithError,
    }
  }),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 12 }),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: mocks.decryptSecret,
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
    mocks.start.mockResolvedValue('workflow-log-1')
    mocks.execute.mockResolvedValue({
      success: true,
      output: { result: 'ok' },
      logs: [],
    })
    mocks.complete.mockResolvedValue(undefined)
    mocks.completeWithError.mockResolvedValue(undefined)
    mocks.checkServerSideUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.decryptSecret.mockImplementation(async (value: string) => ({ decrypted: value }))
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
    })
    mocks.updateWorkflowRunCounts.mockResolvedValue(undefined)
  })

  it('threads required workspace and workflow log context into executor runs without resetting workflow depth', async () => {
    const result = await runPreparedWorkflowExecution({
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
        workflowDepth: 3,
      },
    })

    expect(mocks.loggingSessionConstructor).toHaveBeenCalledWith(
      'workflow-1',
      'execution-1',
      'webhook',
      'executio'
    )
    expect(mocks.start).toHaveBeenCalledWith(
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
          triggerType: 'webhook',
          workflowDepth: 3,
          isDeployedContext: true,
        }),
      })
    )
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 12,
        finalOutput: { result: 'ok' },
        workflowInput: { symbol: 'AAPL' },
      })
    )
    expect(mocks.completeWithError).not.toHaveBeenCalled()
    expect(result.result.success).toBe(true)
    expect(result.result.output).toEqual({ result: 'ok' })
  })

  it('persists encrypted environment references with the terminal workflow log', async () => {
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValueOnce({
      personalEncrypted: { PERSONAL_KEY: 'encrypted-personal' },
      workspaceEncrypted: { WORKSPACE_KEY: 'encrypted-workspace' },
    })

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      start: {
        kind: 'block',
        blockId: 'trigger',
      },
    })

    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          PERSONAL_KEY: 'encrypted-personal',
          WORKSPACE_KEY: 'encrypted-workspace',
        },
      })
    )
  })

  it('returns failed results after terminalizing usage gate failures', async () => {
    mocks.checkServerSideUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      message: 'Usage limit exceeded',
    })

    const result = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      start: {
        kind: 'block',
        blockId: 'trigger',
      },
    })

    expect(mocks.start).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.completeWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Usage limit exceeded',
        }),
      })
    )
    expect(result.result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Usage limit exceeded',
      })
    )
    expect(result.dispatchFailureReason).toBe('usage_limit_exceeded')
  })

  it('reports missing start blocks as dispatch failures', async () => {
    const result = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'webhook',
      workflowInput: {},
      executionId: 'execution-1',
      start: {
        kind: 'block',
        blockId: 'missing',
      },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(result.result.success).toBe(false)
    expect(result.dispatchFailureReason).toBe('missing_start_block')
  })

  it('does not rewrite successful executions as failed when terminal success logging fails', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('log completion failed'))

    await expect(
      runPreparedWorkflowExecution({
        blueprint,
        actorUserId: 'user-1',
        triggerType: 'manual',
        workflowInput: {},
        executionId: 'execution-1',
        start: {
          kind: 'block',
          blockId: 'trigger',
        },
      })
    ).rejects.toThrow('log completion failed')

    expect(mocks.execute).toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('resolves queued child API starts through the child input-trigger path', async () => {
    vi.mocked(TriggerUtils.findStartBlock).mockReturnValue({
      blockId: 'trigger',
      block: { type: 'input_trigger' },
    })

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: { symbol: 'AAPL' },
      executionId: 'execution-1',
      start: {
        kind: 'trigger',
        triggerType: 'api',
      },
      contextExtensions: {
        isChildExecution: true,
      },
    })

    expect(TriggerUtils.findStartBlock).toHaveBeenCalledWith(
      blueprint.workflowData.blocks,
      'api',
      true
    )
    expect(mocks.execute).toHaveBeenCalledWith('workflow-1', 'trigger')
  })

  it('requires workflow log start before executing blocks', async () => {
    mocks.start.mockRejectedValueOnce(new Error('log start failed'))

    await expect(
      runPreparedWorkflowExecution({
        blueprint,
        actorUserId: 'user-1',
        triggerType: 'manual',
        workflowInput: {},
        executionId: 'execution-1',
        start: {
          kind: 'trigger',
          triggerType: 'manual',
        },
      })
    ).rejects.toThrow('log start failed')

    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('persists the response block marker with completed workflow logs', async () => {
    mocks.execute.mockResolvedValueOnce({
      success: true,
      output: { response: { data: { ok: true }, status: 201, headers: {} } },
      logs: [{ blockType: 'response', success: true }],
    })

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      start: {
        kind: 'trigger',
        triggerType: 'manual',
      },
    })

    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        hasResponseBlock: true,
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
