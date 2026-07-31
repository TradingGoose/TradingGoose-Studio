import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerUtils } from '@/lib/workflows/triggers'
import type { WorkflowExecutionBlueprint } from './execution-runner'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution as runPreparedWorkflowExecutionWithLifecycle,
} from './execution-runner'

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
    resolveServerExecutionBillingContext: vi.fn(),
    completeWorkflowOperation: vi.fn(),
    finalizeWorkflowExecution: vi.fn(),
    updateWorkflowRunCounts: vi.fn(),
    reconcileWorkflowExecutionDeadline: vi.fn().mockResolvedValue({ state: 'accounted' }),
    setWorkflowExecutionParticipantState: vi.fn(),
    registerWorkflowOperation: vi.fn(),
    runtimeClose: vi.fn(),
    runtimeRearm: vi.fn(),
    runtimeSettleStartup: vi.fn(),
    runtimeStart: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.dbSelect } }))
vi.mock('@tradinggoose/db/schema', () => ({ workflow: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: mocks.checkServerSideUsageLimits,
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingContext: mocks.resolveServerExecutionBillingContext,
}))

vi.mock('@/lib/execution/workflow-execution-deadline-repository', () => ({
  reconcileWorkflowExecutionDeadline: mocks.reconcileWorkflowExecutionDeadline,
  setWorkflowExecutionParticipantState: mocks.setWorkflowExecutionParticipantState,
}))

vi.mock('@/lib/execution/workflow-execution-lifecycle-repository', () => ({
  beginWorkflowDeadlineTermination: vi.fn(),
  completeWorkflowExecutionAttempt: vi.fn(),
  finalizeWorkflowExecution: mocks.finalizeWorkflowExecution,
  getWorkflowOperationCapability: vi.fn().mockReturnValue('uncancelable'),
  claimWorkflowOperationRemoteDispatch: vi.fn(),
  registerWorkflowOperation: mocks.registerWorkflowOperation,
  completeWorkflowOperation: mocks.completeWorkflowOperation,
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

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 12 }),
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

const claimedLifecycle = {
  policy: {
    kind: 'unlimited' as const,
    rootExecutionId: 'execution-1',
    appliedTierId: 'tier-1',
    processingStartedAt: '2026-01-01T00:00:00.000Z',
  },
  attemptId: 'attempt-1',
  startupOperationId: 'startup-operation',
  isRoot: true,
}

function runPreparedWorkflowExecution(
  params: Omit<
    Parameters<typeof runPreparedWorkflowExecutionWithLifecycle>[0],
    'lifecycle' | 'deadlineRuntime'
  > & {
    lifecycle?: Parameters<typeof runPreparedWorkflowExecutionWithLifecycle>[0]['lifecycle']
    deadlineRuntime?: Parameters<
      typeof runPreparedWorkflowExecutionWithLifecycle
    >[0]['deadlineRuntime']
  }
) {
  return runPreparedWorkflowExecutionWithLifecycle({
    ...params,
    lifecycle: params.lifecycle ?? claimedLifecycle,
    deadlineRuntime: params.deadlineRuntime ?? {
      start: mocks.runtimeStart,
      rearm: mocks.runtimeRearm,
      settleStartup: mocks.runtimeSettleStartup,
      close: mocks.runtimeClose,
    },
  })
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
    mocks.completeWorkflowOperation.mockResolvedValue(undefined)
    mocks.checkServerSideUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.decryptSecret.mockImplementation(async (value: string) => ({ decrypted: value }))
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
    })
    mocks.resolveServerExecutionBillingContext.mockResolvedValue({
      tier: {
        id: 'tier-1',
        workflowExecutionTimeLimitSeconds: null,
      },
    })
    mocks.finalizeWorkflowExecution.mockImplementation(async ({ result }) => result)
    mocks.updateWorkflowRunCounts.mockResolvedValue(undefined)
    mocks.reconcileWorkflowExecutionDeadline.mockResolvedValue({ state: 'accounted' })
    mocks.setWorkflowExecutionParticipantState.mockResolvedValue(undefined)
    mocks.registerWorkflowOperation.mockReset().mockResolvedValue({ id: 'startup-operation' })
    mocks.runtimeClose.mockReset()
    mocks.runtimeRearm.mockReset().mockResolvedValue(undefined)
    mocks.runtimeSettleStartup.mockReset().mockResolvedValue(undefined)
    mocks.runtimeStart.mockReset().mockResolvedValue(undefined)
  })

  it('threads required workspace and workflow log context into executor runs without resetting workflow depth', async () => {
    const result = await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'webhook',
      workflowInput: { symbol: 'AAPL' },
      executionId: 'execution-1',
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
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
    expect(result.result.success).toBe(true)
    expect(result.result.output).toEqual({ result: 'ok' })
  })

  it('arms bounded enforcement before workflow logging and stops expired startup work', async () => {
    const controller = new AbortController()
    controller.abort()

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: { kind: 'block', blockId: 'trigger' },
      lifecycle: {
        policy: {
          kind: 'bounded',
          rootExecutionId: 'execution-1',
          appliedTierId: 'tier-1',
          processingStartedAt: '2026-01-01T00:00:00.000Z',
          limitSeconds: '1',
          limitMicroseconds: '1000000',
        },
        attemptId: 'attempt-1',
        startupOperationId: 'startup-operation',
        participantId: 'participant-1',
        isRoot: true,
      },
      deadlineRuntime: {
        signal: controller.signal,
        start: mocks.runtimeStart,
        rearm: mocks.runtimeRearm,
        settleStartup: mocks.runtimeSettleStartup,
        close: mocks.runtimeClose,
      },
    })

    expect(mocks.registerWorkflowOperation).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.checkServerSideUsageLimits).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.runtimeSettleStartup).toHaveBeenCalledWith('local_abort')
  })

  it('leaves terminal workflow-log projection to the durable outbox', async () => {
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
      triggerTarget: {
        kind: 'block',
        blockId: 'trigger',
      },
    })

    expect(mocks.complete).not.toHaveBeenCalled()
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
      triggerTarget: {
        kind: 'block',
        blockId: 'trigger',
      },
    })

    expect(mocks.start).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
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
      triggerTarget: {
        kind: 'block',
        blockId: 'missing',
      },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(result.result.success).toBe(false)
    expect(result.dispatchFailureReason).toBe('missing_trigger_block')
  })

  it('does not call the legacy terminal log completion path', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('log completion failed'))

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      triggerTarget: {
        kind: 'block',
        blockId: 'trigger',
      },
    })

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
      triggerTarget: {
        kind: 'trigger',
        triggerType: 'manual',
      },
    })

    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('serializes aggregate nested-child wait transitions', async () => {
    const states: string[] = []
    mocks.setWorkflowExecutionParticipantState.mockImplementation(async ({ state }) => {
      if (state === 'waiting_child') await Promise.resolve()
      states.push(state)
    })
    mocks.execute.mockImplementationOnce(async () => {
      const context = mocks.executorConstructor.mock.calls.at(-1)?.[0].contextExtensions
      mocks.registerWorkflowOperation
        .mockResolvedValueOnce({ id: 'operation-1' })
        .mockResolvedValueOnce({ id: 'operation-2' })
      const operation1 = await context.registerWorkflowOperation('block-1', 'workflow')
      const operation2 = await context.registerWorkflowOperation('block-2', 'workflow')
      await Promise.all([
        context.setWorkflowParticipantWaiting(operation1, true),
        context.setWorkflowParticipantWaiting(operation2, true),
        context.setWorkflowParticipantWaiting(operation1, false),
        context.setWorkflowParticipantWaiting(operation2, false),
      ])
      return { success: true, output: {}, logs: [] }
    })

    await runPreparedWorkflowExecution({
      blueprint,
      actorUserId: 'user-1',
      triggerType: 'manual',
      workflowInput: {},
      executionId: 'execution-1',
      lifecycle: {
        policy: {
          kind: 'bounded',
          rootExecutionId: 'execution-1',
          appliedTierId: 'tier-1',
          processingStartedAt: '2026-01-01T00:00:00.000Z',
          limitSeconds: '60',
          limitMicroseconds: '60000000',
        },
        attemptId: 'attempt-1',
        startupOperationId: 'startup-operation',
        participantId: 'participant-1',
        isRoot: true,
      },
      triggerTarget: { kind: 'block', blockId: 'trigger' },
    })

    expect(states).toEqual(['waiting_child', 'active'])
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
