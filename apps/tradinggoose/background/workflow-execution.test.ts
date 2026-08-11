/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttemptTimeBudget } from '@/lib/execution/workflow-execution-time-budget'

const {
  runWorkflowExecutionMock,
  buildTraceSpansMock,
  createWorkflowExecutionEventWriterMock,
  runPreparedWorkflowExecutionMock,
  writeExecutionEventMock,
  isPendingWorkflowExecutionCancellationRequestedMock,
  disableMonitorMock,
} = vi.hoisted(() => ({
  runWorkflowExecutionMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  createWorkflowExecutionEventWriterMock: vi.fn(),
  runPreparedWorkflowExecutionMock: vi.fn(),
  writeExecutionEventMock: vi.fn(),
  isPendingWorkflowExecutionCancellationRequestedMock: vi.fn(),
  disableMonitorMock: vi.fn(),
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  createWorkflowExecutionEventWriter: createWorkflowExecutionEventWriterMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  isPendingWorkflowExecutionCancellationRequested:
    isPendingWorkflowExecutionCancellationRequestedMock,
}))

vi.mock('@/lib/workflows/execution-runner', () => ({
  runWorkflowExecution: runWorkflowExecutionMock,
  runPreparedWorkflowExecution: runPreparedWorkflowExecutionMock,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: buildTraceSpansMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
  })),
}))

vi.mock('./monitor-disable', () => ({
  disableMonitor: disableMonitorMock,
}))

import { executeWorkflowJob } from './workflow-execution'

const rootAttempt = {
  attemptStartedAt: '2026-01-01T00:00:05.000Z',
  timePolicy: {
    kind: 'unlimited' as const,
    processingStartedAt: '2026-01-01T00:00:05.000Z',
    tier: { source: 'no-tier' as const },
  },
  timeBudget: {
    expired: new Promise<void>(() => undefined),
    remainingMilliseconds: () => null,
  } as any,
  fallbackActorUserId: 'user-1',
  fallbackWorkspaceId: 'workspace-1',
}

describe('executeWorkflowJob', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    runWorkflowExecutionMock.mockResolvedValue({
      result: {
        success: true,
        output: { ok: true },
        metadata: { duration: 12 },
      },
    })
    runPreparedWorkflowExecutionMock.mockResolvedValue({
      result: { success: true, output: { ok: true }, logs: [] },
      workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
      workspaceId: 'workspace-1',
    })
    buildTraceSpansMock.mockReturnValue({
      traceSpans: [],
    })
    createWorkflowExecutionEventWriterMock.mockResolvedValue({
      write: writeExecutionEventMock,
    })
    writeExecutionEventMock.mockResolvedValue(undefined)
    isPendingWorkflowExecutionCancellationRequestedMock.mockResolvedValue(false)
  })

  it('terminalizes an expired attempt while preparation is still pending and suppresses it later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
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
    const timeBudget = new AttemptTimeBudget(boundedPolicy, 1_000)
    let finishPreparation!: (value: any) => void
    const preparation = new Promise<any>((resolve) => {
      finishPreparation = resolve
    })
    runPreparedWorkflowExecutionMock.mockResolvedValue({
      result: {
        success: false,
        output: {},
        logs: [],
        code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      },
      workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
      workspaceId: 'workspace-1',
    })

    const execution = executeWorkflowJob(
      { workflowId: 'workflow-1', userId: 'user-1' },
      { ...rootAttempt, timePolicy: boundedPolicy, timeBudget },
      () => preparation
    )
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(execution).resolves.toMatchObject({
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      success: false,
    })
    expect(runPreparedWorkflowExecutionMock).toHaveBeenCalledOnce()
    expect(runPreparedWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        blueprint: expect.objectContaining({
          workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
        }),
        timeBudget,
      })
    )

    finishPreparation({
      kind: 'execute',
      payload: { workflowId: 'workflow-1', userId: 'user-1' },
      blueprint: {
        workflowId: 'workflow-1',
        executionTarget: 'deployed',
        workflowContext: { workspaceId: 'workspace-1', variables: null },
        workflowData: { blocks: { late: {} }, edges: [], loops: {}, parallels: {} },
      },
    })
    await Promise.resolve()
    expect(runPreparedWorkflowExecutionMock).toHaveBeenCalledOnce()
    timeBudget.dispose()
  })

  it('marks queued workflow-block executions as child executions', async () => {
    const inheritedPolicy = {
      kind: 'unlimited' as const,
      processingStartedAt: '2026-01-01T00:00:00.000Z',
      tier: { source: 'no-tier' as const },
    }
    runWorkflowExecutionMock.mockResolvedValueOnce({
      result: {
        success: true,
        output: { ok: true },
        remainingMilliseconds: 7_500,
        metadata: { duration: 12 },
      },
    })
    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        metadata: {
          source: 'workflow_block',
          parentBlockId: 'block-1',
          timePolicy: inheritedPolicy,
        },
      },
      { ...rootAttempt, timePolicy: inheritedPolicy }
    )

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        actorUserId: 'user-1',
        attemptStartedAt: '2026-01-01T00:00:05.000Z',
        contextExtensions: expect.objectContaining({
          workflowDepth: 0,
          isChildExecution: true,
          shouldCancelExecution: expect.any(Function),
        }),
      })
    )
    expect(createWorkflowExecutionEventWriterMock).toHaveBeenCalledWith({
      pendingExecutionId: expect.any(String),
      workflowId: 'workflow-1',
    })
    expect(writeExecutionEventMock).toHaveBeenLastCalledWith({
      type: 'execution:completed',
      data: {
        result: expect.objectContaining({ remainingMilliseconds: 7_500 }),
      },
    })
  })

  it('rejects a nested policy that expands the inherited allowance', async () => {
    await expect(
      executeWorkflowJob(
        {
          workflowId: 'workflow-1',
          userId: 'user-1',
          metadata: {
            source: 'workflow_block',
            parentBlockId: 'block-1',
            timePolicy: {
              kind: 'bounded',
              processingStartedAt: '2026-01-01T00:00:00.000Z',
              tier: {
                source: 'resolved-tier',
                appliedTierId: 'tier-1',
                appliedTierName: 'Pro',
              },
              limitSeconds: 10,
              accounting: { mode: 'remaining', remainingMilliseconds: 10_001 },
            },
          },
        },
        rootAttempt
      )
    ).rejects.toThrow('authenticated time policy')
    expect(runWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('does not mark non-child queued workflow executions as child executions', async () => {
    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        metadata: {
          source: 'workflow_queue',
        },
      },
      rootAttempt
    )

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contextExtensions: expect.objectContaining({
          workflowDepth: 0,
          isChildExecution: false,
          stream: false,
        }),
      })
    )
    expect(createWorkflowExecutionEventWriterMock).not.toHaveBeenCalled()
    expect(runWorkflowExecutionMock.mock.calls[0]?.[0].timePolicy).toBe(rootAttempt.timePolicy)
  })

  it('enables chunk streaming only when requested by the queued payload', async () => {
    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        stream: true,
        selectedOutputs: ['agent-1_content'],
      },
      rootAttempt
    )

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contextExtensions: expect.objectContaining({
          stream: true,
          selectedOutputs: ['agent-1_content'],
        }),
      })
    )
    expect(createWorkflowExecutionEventWriterMock).toHaveBeenCalledWith({
      pendingExecutionId: expect.any(String),
      workflowId: 'workflow-1',
    })
  })

  it('executes queued editor payloads with supplied live workflow data', async () => {
    const workflowData = {
      blocks: {
        'trigger-1': { id: 'trigger-1', type: 'manual_trigger' },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        input: { symbol: 'AAPL' },
        triggerType: 'manual',
        executionTarget: 'live',
        workflowData,
        workflowVariables: { risk: { value: 1 } },
        triggerBlockId: 'trigger-1',
        metadata: {
          source: 'workflow_queue',
        },
      },
      rootAttempt
    )

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        actorUserId: 'user-1',
        workflowInput: { symbol: 'AAPL' },
        executionTarget: 'live',
        workflowData,
        workflowContext: {
          workspaceId: 'workspace-1',
          variables: { risk: { value: 1 } },
        },
        triggerTarget: {
          kind: 'block',
          blockId: 'trigger-1',
        },
      })
    )
  })

  it('preserves manual queued starts when no explicit trigger block is supplied', async () => {
    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        triggerType: 'manual',
        metadata: {
          source: 'workflow_queue',
        },
      },
      rootAttempt
    )

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'manual',
        triggerTarget: {
          kind: 'trigger',
          triggerType: 'manual',
        },
      })
    )
  })

  it('checks queued cancellation state through the execution id', async () => {
    await executeWorkflowJob(
      { workflowId: 'workflow-1', userId: 'user-1', executionId: 'execution-1' },
      rootAttempt
    )

    const call = runWorkflowExecutionMock.mock.calls[0]?.[0] as any
    await call.contextExtensions.shouldCancelExecution()

    expect(isPendingWorkflowExecutionCancellationRequestedMock).toHaveBeenCalledWith('execution-1')
  })

  it('disables monitor workflow sources after permanent dispatch failures', async () => {
    runWorkflowExecutionMock.mockResolvedValueOnce({
      dispatchFailureReason: 'usage_limit_exceeded',
      result: {
        success: false,
        output: {},
        error: 'Usage limit exceeded',
        metadata: { duration: 0 },
      },
    })

    await executeWorkflowJob(
      {
        workflowId: 'workflow-1',
        userId: 'user-1',
        triggerType: 'webhook',
        triggerBlockId: 'trigger-1',
        triggerData: {
          source: 'indicator_trigger',
          monitor: { id: 'monitor-1' },
        },
      },
      rootAttempt
    )

    expect(disableMonitorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: 'monitor-1',
        provider: 'indicator',
        reason: 'usage_limit_exceeded',
        workflowId: 'workflow-1',
      })
    )
  })
})
