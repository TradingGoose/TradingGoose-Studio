import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const stopForDeadline = vi.fn()
  const snapshotBlockLogsForDeadline = vi.fn()
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
    stopForDeadline,
    snapshotBlockLogsForDeadline,
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
  LoggingSession: vi.fn().mockImplementation(function (...args) {
    void new.target
    mocks.loggingSessionConstructor(...args)
    return {
      start: mocks.start,
      complete: mocks.complete,
      completeWithError: mocks.completeWithError,
    }
  }),
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: mocks.decryptSecret,
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadDeployedWorkflowState: vi.fn(),
  requireWorkflowRealtimeState: vi.fn(),
}))

vi.mock('@/lib/workflows/triggers', () => ({
  TriggerUtils: {
    findTriggerBlock: vi.fn(),
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  updateWorkflowRunCounts: mocks.updateWorkflowRunCounts,
}))

vi.mock('@/lib/workflows/variable-utils', () => ({
  normalizeVariables: vi.fn().mockReturnValue({}),
}))

vi.mock('@/serializer', () => ({
  Serializer: vi.fn().mockImplementation(function () {
    void new.target
    return {
      serializeWorkflow: vi.fn((_blocks, edges, loops, parallels) => ({
        connections: edges,
        loops,
        parallels,
      })),
    }
  }),
}))

vi.mock('@/stores/workflows/server-utils', () => ({
  mergeSubblockState: vi.fn((blocks) => blocks),
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(function (options) {
    void new.target
    mocks.executorConstructor(options)
    return {
      execute: mocks.execute,
      stopForDeadline: mocks.stopForDeadline,
      snapshotBlockLogsForDeadline: mocks.snapshotBlockLogsForDeadline,
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
  afterEach(() => vi.useRealTimers())
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
    mocks.snapshotBlockLogsForDeadline.mockReturnValue([])
  })

  const boundedPolicy = {
    kind: 'bounded' as const,
    processingStartedAt: '2026-01-01T00:00:00.000Z',
    tier: {
      source: 'resolved-tier' as const,
      appliedTierId: 'tier-1',
      appliedTierName: 'Pro',
    },
    limitSeconds: 1,
    accounting: { mode: 'remaining' as const, remainingMilliseconds: 1_000 },
  }
  const unlimitedPolicy = {
    kind: 'unlimited' as const,
    processingStartedAt: '2026-01-01T00:00:00.000Z',
    tier: { source: 'no-tier' as const },
  }

  it('stops and terminalizes a bounded execution once while suppressing a late settlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    let resolveExecution!: (value: any) => void
    mocks.execute.mockReturnValue(
      new Promise((resolve) => {
        resolveExecution = resolve
      })
    )
    const liveLogs = [
      {
        blockId: 'wait-1',
        blockType: 'wait',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1_000,
        success: false,
        code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
        input: { nested: { value: 'captured' } },
        output: { secret: 'must not persist' },
        futurePayload: { secret: 'must not persist' },
      },
    ]
    mocks.snapshotBlockLogsForDeadline.mockImplementation(() => structuredClone(liveLogs))
    const execution = runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: { kind: 'block', blockId: 'trigger' },
      timePolicy: boundedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
    })
    await vi.advanceTimersByTimeAsync(1_000)
    const outcome = await execution
    expect(outcome.result.code).toBe('WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED')
    expect(mocks.stopForDeadline).toHaveBeenCalledTimes(1)
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
          deadline: expect.objectContaining({ appliedTierName: 'Pro', limitSeconds: 1 }),
          logs: [expect.objectContaining({ blockId: 'wait-1', error: expect.any(String) })],
        }),
        traceSpans: [
          expect.objectContaining({
            blockId: 'wait-1',
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            status: 'error',
            startTime: '2026-01-01T00:00:00.000Z',
            endTime: '2026-01-01T00:00:01.000Z',
            duration: 1_000,
            output: expect.objectContaining({ error: expect.any(String) }),
          }),
        ],
      })
    )

    liveLogs[0]!.input.nested.value = 'late mutation'
    resolveExecution({ success: true, output: { late: true }, logs: [] })
    await Promise.resolve()
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.complete.mock.calls[0]?.[0].result).not.toHaveProperty('output')
    expect(mocks.complete.mock.calls[0]?.[0].result.logs[0]).not.toHaveProperty('input')
    expect(mocks.complete.mock.calls[0]?.[0].result.logs[0]).not.toHaveProperty('output')
    expect(mocks.complete.mock.calls[0]?.[0].result.logs[0]).not.toHaveProperty('futurePayload')
  })

  it('expires while startup is pending and never dispatches after startup settles late', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    let resolveUsage!: (value: { isExceeded: boolean }) => void
    mocks.checkServerSideUsageLimits.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUsage = resolve
      })
    )

    const execution = runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: { kind: 'block', blockId: 'trigger' },
      timePolicy: boundedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
    })

    await vi.advanceTimersByTimeAsync(1_000)
    const outcome = await execution
    expect(outcome.result.code).toBe('WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.updateWorkflowRunCounts).not.toHaveBeenCalled()

    resolveUsage({ isExceeded: false })
    await Promise.resolve()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when startup has exhausted the budget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'))
    const outcome = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: { kind: 'block', blockId: 'trigger' },
      timePolicy: boundedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(outcome.result.code).toBe('WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('keeps unlimited execution behavior unchanged', async () => {
    const outcome = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: { kind: 'block', blockId: 'trigger' },
      timePolicy: {
        kind: 'unlimited',
        processingStartedAt: '2026-01-01T00:00:00.000Z',
        tier: { source: 'no-tier' },
      },
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(outcome.result.success).toBe(true)
    expect(mocks.stopForDeadline).not.toHaveBeenCalled()
  })

  it('threads required workspace and workflow log context into executor runs without resetting workflow depth', async () => {
    const result = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'webhook',
      workflowInput: { symbol: 'AAPL' },
      executionId: 'execution-1',
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
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
        totalDurationMs: 0,
        finalOutput: { result: 'ok' },
        workflowInput: { symbol: 'AAPL' },
        result: undefined,
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
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
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
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
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
        result: undefined,
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

  it('reports missing trigger blocks as dispatch failures', async () => {
    const result = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'webhook',
      workflowInput: {},
      executionId: 'execution-1',
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
        kind: 'block',
        blockId: 'missing',
      },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(result.result.success).toBe(false)
    expect(result.dispatchFailureReason).toBe('missing_trigger_block')
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
        timePolicy: unlimitedPolicy,
        attemptStartedAt: '2026-01-01T00:00:00.000Z',
        triggerTarget: {
          kind: 'block',
          blockId: 'trigger',
        },
      })
    ).rejects.toThrow('log completion failed')

    expect(mocks.execute).toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('resolves queued child API triggers through the child input-trigger path', async () => {
    vi.mocked(TriggerUtils.findTriggerBlock).mockReturnValue({
      blockId: 'trigger',
      block: { type: 'input_trigger' },
    })

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: { symbol: 'AAPL' },
      executionId: 'execution-1',
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
        kind: 'trigger',
        triggerType: 'api',
      },
      contextExtensions: {
        isChildExecution: true,
      },
    })

    expect(TriggerUtils.findTriggerBlock).toHaveBeenCalledWith(
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
        timePolicy: unlimitedPolicy,
        attemptStartedAt: '2026-01-01T00:00:00.000Z',
        triggerTarget: {
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
      timePolicy: unlimitedPolicy,
      attemptStartedAt: '2026-01-01T00:00:00.000Z',
      triggerTarget: {
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

  it('loads Yjs workflow state for live execution when no snapshot is supplied', async () => {
    const { loadDeployedWorkflowState, requireWorkflowRealtimeState } = await import(
      '@/lib/workflows/db-helpers'
    )
    vi.mocked(requireWorkflowRealtimeState).mockResolvedValueOnce({
      blocks: { trigger: { subBlocks: {} } },
      edges: [{ source: 'trigger', target: 'worker' }],
      loops: {},
      parallels: {},
      variables: { risk: { value: 1 } },
      lastSaved: Date.now(),
    })

    const result = await loadWorkflowExecutionBlueprint({
      workflowId: 'workflow-1',
      executionTarget: 'live',
      workflowContext: {
        workspaceId: 'workspace-1',
      },
    })

    expect(result.workflowData.blocks).toEqual({ trigger: { subBlocks: {} } })
    expect(result.workflowContext.variables).toEqual({ risk: { value: 1 } })
    expect(loadDeployedWorkflowState).not.toHaveBeenCalled()
    expect(requireWorkflowRealtimeState).toHaveBeenCalledWith('workflow-1')
    expect(mocks.dbSelect).not.toHaveBeenCalled()
  })

  it('uses variables from the active deployment for deployed execution', async () => {
    const { loadDeployedWorkflowState, requireWorkflowRealtimeState } = await import(
      '@/lib/workflows/db-helpers'
    )
    const deployedVariables = {
      risk: { id: 'var-deployed', name: 'risk', value: 'deployed' },
    }
    vi.mocked(loadDeployedWorkflowState).mockResolvedValueOnce({
      blocks: {
        trigger: {
          id: 'trigger',
          type: 'api_trigger',
          name: 'Trigger',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [{ id: 'edge-1', source: 'trigger', target: 'worker' }],
      loops: {},
      parallels: {},
      variables: deployedVariables,
      isFromNormalizedTables: false,
    })
    mocks.dbRowsQueue.push([
      {
        workspaceId: 'workspace-1',
        variables: { risk: { id: 'var-live', name: 'risk', value: 'live' } },
      },
    ])

    const result = await loadWorkflowExecutionBlueprint({
      workflowId: 'workflow-1',
      executionTarget: 'deployed',
    })

    expect(result.workflowContext.variables).toEqual(deployedVariables)
    expect(result.workflowData.blocks.trigger?.subBlocks).toEqual({})
    const selectShape = (mocks.dbSelect.mock.calls as unknown[][])[0]?.[0] as Record<
      string,
      unknown
    >
    expect(Object.keys(selectShape)).toEqual(['workspaceId'])
    expect(requireWorkflowRealtimeState).not.toHaveBeenCalled()
  })
})
