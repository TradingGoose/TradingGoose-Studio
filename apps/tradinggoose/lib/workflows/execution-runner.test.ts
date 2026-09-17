import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowCheckpointSnapshot,
  WorkflowPausePoint,
} from '@/lib/workflows/human-in-the-loop/types'
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
    saveWorkflowCheckpoint: vi.fn(),
    completeWorkflowCheckpointChild: vi.fn(),
    cancelPendingExecutionDescendants: vi.fn(),
    dispatchWorkflowPauseNotifications: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.dbSelect } }))
vi.mock('@tradinggoose/db/schema', () => ({ workflow: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/background/pending-execution-worker', () => ({
  cancelPendingExecutionDescendants: mocks.cancelPendingExecutionDescendants,
}))

vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  saveWorkflowCheckpoint: mocks.saveWorkflowCheckpoint,
  completeWorkflowCheckpointChild: mocks.completeWorkflowCheckpointChild,
}))
vi.mock('@/lib/workflows/human-in-the-loop/notifications', () => ({
  dispatchWorkflowPauseNotifications: mocks.dispatchWorkflowPauseNotifications,
}))

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

const baseRunParams = {
  blueprint,
  actorUserId: 'user-1',
  triggerType: 'manual' as const,
  workflowInput: {},
  executionId: 'execution-1',
  triggerTarget: { kind: 'block' as const, blockId: 'trigger' },
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
    mocks.saveWorkflowCheckpoint.mockResolvedValue({ revision: 2 })
    mocks.completeWorkflowCheckpointChild.mockResolvedValue(undefined)
    mocks.cancelPendingExecutionDescendants.mockResolvedValue(undefined)
    mocks.dispatchWorkflowPauseNotifications.mockResolvedValue(undefined)
  })

  it('threads required workspace and workflow log context into executor runs without resetting workflow depth', async () => {
    const result = await runPreparedWorkflowExecution({
      ...baseRunParams,
      triggerType: 'webhook',
      workflowInput: { symbol: 'AAPL' },
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
      'executio',
      undefined
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
    expect(mocks.cancelPendingExecutionDescendants).not.toHaveBeenCalled()
    expect(result.result.success).toBe(true)
    expect(result.result.output).toEqual({ result: 'ok' })
  })

  it('persists encrypted environment references with the terminal workflow log', async () => {
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValueOnce({
      personalEncrypted: { PERSONAL_KEY: 'encrypted-personal' },
      workspaceEncrypted: { WORKSPACE_KEY: 'encrypted-workspace' },
    })

    await runPreparedWorkflowExecution(baseRunParams)

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

    const result = await runPreparedWorkflowExecution(baseRunParams)

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
    expect(mocks.cancelPendingExecutionDescendants).toHaveBeenCalledExactlyOnceWith('execution-1')
  })

  it('reports missing trigger blocks as dispatch failures', async () => {
    const result = await runPreparedWorkflowExecution({
      ...baseRunParams,
      triggerType: 'webhook',
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

    await expect(runPreparedWorkflowExecution(baseRunParams)).rejects.toThrow(
      'log completion failed'
    )

    expect(mocks.execute).toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('resolves queued child API triggers through the child input-trigger path', async () => {
    vi.mocked(TriggerUtils.findTriggerBlock).mockReturnValue({
      blockId: 'trigger',
      block: { type: 'input_trigger' },
    })

    await runPreparedWorkflowExecution({
      ...baseRunParams,
      workflowInput: { symbol: 'AAPL' },
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
        ...baseRunParams,
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
      ...baseRunParams,
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

  const pausePoint: WorkflowPausePoint = {
    id: 'review',
    blockId: 'review',
    blockName: 'Review',
    kind: 'human',
    displayData: { order: 'AAPL' },
    inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
  }
  const snapshot = {
    blueprint,
    workflowInput: { symbol: 'AAPL' },
    triggerType: 'manual',
    workflowLogId: 'original-log',
    encryptedEnvVars: { TOKEN: 'encrypted-original' },
    executor: {
      workflow: { blocks: [], connections: [], loops: {}, parallels: {} },
      currentBlockStates: { upstream: { result: 'already-ran' } },
      iteration: 3,
      finalOutput: { result: 'already-ran' },
      context: {
        triggerBlockId: 'saved-trigger',
        workflowDepth: 2,
        environmentVariables: { TOKEN: 'decrypted-original' },
        workflowVariables: { risk: { value: 5 } },
        executedBlocks: ['upstream'],
        blockLogs: [{ blockId: 'upstream', success: true }],
      },
    },
  } as unknown as WorkflowCheckpointSnapshot
  const runParams = {
    ...baseRunParams,
    workflowInput: snapshot.workflowInput,
  }
  const pausedResult = {
    success: true,
    status: 'paused',
    logs: [],
    checkpoint: snapshot.executor,
    pausePoints: [pausePoint],
  }

  it('persists a pause before notifying without terminal logging, run counts, or exposing private snapshots', async () => {
    const onExecutionEvent = vi.fn().mockResolvedValue(undefined)
    mocks.execute.mockResolvedValueOnce({
      ...pausedResult,
      output: { secret: 'private-output' },
    })

    const result = await runPreparedWorkflowExecution({
      ...runParams,
      contextExtensions: { onExecutionEvent, pendingExecutionId: 'execution-1' },
    })

    expect(mocks.saveWorkflowCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        pendingExecutionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        pausePoints: [pausePoint],
        snapshot: expect.objectContaining({
          blueprint,
          executor: snapshot.executor,
          workflowLogId: 'workflow-log-1',
        }),
      })
    )
    expect(mocks.saveWorkflowCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatchWorkflowPauseNotifications.mock.invocationCallOrder[0]
    )
    expect(result.result).toMatchObject({
      success: true,
      status: 'paused',
      output: { revision: 2 },
    })
    expect(result.result).not.toHaveProperty('checkpoint')
    expect(result.result).not.toHaveProperty('pausePoints')
    expect(JSON.stringify(result.result)).not.toContain('decrypted-original')
    expect(JSON.stringify(result.result)).not.toContain('private-output')
    expect(onExecutionEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'execution:paused',
      data: { result: result.result },
    })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
    expect(mocks.updateWorkflowRunCounts).not.toHaveBeenCalled()
    expect(mocks.cancelPendingExecutionDescendants).not.toHaveBeenCalled()
  })

  it('preserves a saved pause when notification or event delivery fails', async () => {
    mocks.execute.mockResolvedValueOnce(pausedResult)
    mocks.dispatchWorkflowPauseNotifications.mockRejectedValueOnce(new Error('notification down'))
    const onExecutionEvent = vi.fn().mockRejectedValue(new Error('stream down'))

    const result = await runPreparedWorkflowExecution({
      ...runParams,
      contextExtensions: { onExecutionEvent },
    })

    expect(result.result.status).toBe('paused')
    expect(mocks.saveWorkflowCheckpoint).toHaveBeenCalledTimes(1)
    expect(mocks.dispatchWorkflowPauseNotifications).toHaveBeenCalledTimes(1)
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('persists child waits without running queue recovery inside the execution failure boundary', async () => {
    const childPoint: WorkflowPausePoint = {
      ...pausePoint,
      kind: 'child',
      childExecutionId: 'child-execution',
      childWorkflowId: 'child-workflow',
    }
    mocks.execute.mockResolvedValueOnce({
      ...pausedResult,
      pausePoints: [childPoint],
    })
    const result = await runPreparedWorkflowExecution(runParams)

    expect(result.result.status).toBe('paused')
    expect(mocks.saveWorkflowCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ pausePoints: [childPoint] })
    )
    expect(mocks.completeWorkflowCheckpointChild).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('resumes the saved executor and original log without reloading inputs, secrets, or workflow state', async () => {
    const resume = { snapshot, pausePoints: [{ ...pausePoint, input: { approved: true } }] }
    await runPreparedWorkflowExecution({
      ...runParams,
      resume,
      contextExtensions: { pendingExecutionId: 'execution-1:resume:2' },
    })

    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.loggingSessionConstructor).toHaveBeenCalledWith(
      'workflow-1',
      'execution-1',
      'manual',
      'executio',
      'original-log'
    )
    expect(mocks.getPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mocks.decryptSecret).not.toHaveBeenCalled()
    expect(mocks.executorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: snapshot.executor,
        workflow: snapshot.executor.workflow,
        currentBlockStates: snapshot.executor.currentBlockStates,
        envVarValues: { TOKEN: 'decrypted-original' },
        workflowVariables: snapshot.executor.context.workflowVariables,
        resumeInputs: new Map([['review', { approved: true }]]),
        contextExtensions: expect.objectContaining({
          userId: 'user-1',
          executionId: 'execution-1',
          pendingExecutionId: 'execution-1:resume:2',
          workflowLogId: 'original-log',
          workflowDepth: 2,
        }),
      })
    )
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('workflow-1', 'saved-trigger')
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.updateWorkflowRunCounts).toHaveBeenCalledExactlyOnceWith('workflow-1')
  })

  it.each([
    { resumed: false, thrown: false },
    { resumed: false, thrown: true },
    { resumed: true, thrown: false },
    { resumed: true, thrown: true },
  ])(
    'cancels descendants after terminal failure and before notifying its parent: %j',
    async ({ resumed, thrown }) => {
      const failure = {
        success: false,
        error: 'downstream failed',
        logs: resumed ? snapshot.executor.context.blockLogs : [],
      }
      if (thrown) mocks.execute.mockRejectedValueOnce(new Error(failure.error))
      else mocks.execute.mockResolvedValueOnce(failure)
      const result = await runPreparedWorkflowExecution({
        ...runParams,
        contextExtensions: {
          isChildExecution: true,
          pendingExecutionId: resumed ? 'execution-1:resume:2' : 'execution-1',
        },
        ...(resumed ? { resume: { snapshot, pausePoints: [pausePoint] } } : {}),
      })

      expect(result.result).toMatchObject(failure)
      expect(mocks.start).toHaveBeenCalledTimes(resumed ? 0 : 1)
      const terminalize = thrown ? mocks.completeWithError : mocks.complete
      expect(terminalize).toHaveBeenCalledTimes(1)
      expect(thrown ? mocks.complete : mocks.completeWithError).not.toHaveBeenCalled()
      expect(mocks.cancelPendingExecutionDescendants).toHaveBeenCalledExactlyOnceWith('execution-1')
      expect(terminalize.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.cancelPendingExecutionDescendants.mock.invocationCallOrder[0]
      )
      expect(mocks.cancelPendingExecutionDescendants.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.completeWorkflowCheckpointChild.mock.invocationCallOrder[0]
      )
      expect(mocks.saveWorkflowCheckpoint).not.toHaveBeenCalled()
      expect(mocks.updateWorkflowRunCounts).not.toHaveBeenCalled()
    }
  )

  it('propagates cleanup failures for worker recovery without terminalizing twice', async () => {
    mocks.execute.mockResolvedValueOnce({ success: false, error: 'sibling failed', logs: [] })
    mocks.cancelPendingExecutionDescendants.mockRejectedValueOnce(new Error('cleanup failed'))
    await expect(
      runPreparedWorkflowExecution({
        ...baseRunParams,
        contextExtensions: { isChildExecution: true },
      })
    ).rejects.toThrow('cleanup failed')
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.completeWithError).not.toHaveBeenCalled()
    expect(mocks.completeWorkflowCheckpointChild).not.toHaveBeenCalled()
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
