/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runWorkflowExecutionMock,
  buildTraceSpansMock,
  createWorkflowExecutionEventWriterMock,
  writeExecutionEventMock,
  isPendingWorkflowExecutionCancellationRequestedMock,
  disableMonitorMock,
  finalizeWorkflowExecutionMock,
  completeWorkflowExecutionAttemptMock,
} = vi.hoisted(() => ({
  runWorkflowExecutionMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  createWorkflowExecutionEventWriterMock: vi.fn(),
  writeExecutionEventMock: vi.fn(),
  isPendingWorkflowExecutionCancellationRequestedMock: vi.fn(),
  disableMonitorMock: vi.fn(),
  finalizeWorkflowExecutionMock: vi.fn(),
  completeWorkflowExecutionAttemptMock: vi.fn(),
}))

vi.mock('@/lib/execution/workflow-execution-lifecycle-repository', () => ({
  finalizeWorkflowExecution: finalizeWorkflowExecutionMock,
  completeWorkflowExecutionAttempt: completeWorkflowExecutionAttemptMock,
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
}))

vi.mock('@/lib/execution/workflow-execution-runtime', () => ({
  createWorkflowExecutionRuntime: vi.fn().mockReturnValue({
    start: vi.fn(),
    rearm: vi.fn(),
    settleStartup: vi.fn(),
    close: vi.fn(),
  }),
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

import { executeWorkflowJob as executeClaimedWorkflowJob } from './workflow-execution'

function executeWorkflowJob(
  payload: Omit<Parameters<typeof executeClaimedWorkflowJob>[0], 'workflowExecutionLifecycle'>
) {
  return executeClaimedWorkflowJob({
    ...payload,
    workflowExecutionLifecycle: {
      policy: {
        kind: 'unlimited',
        rootExecutionId: payload.executionId ?? 'execution-1',
        appliedTierId: 'tier-1',
        appliedTierName: 'Tier 1',
        processingStartedAt: '2026-01-01T00:00:00.000Z',
      },
      attemptId: 'attempt-1',
      startupOperationId: 'startup-operation',
      isRoot: true,
    },
  })
}

describe('executeWorkflowJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runWorkflowExecutionMock.mockResolvedValue({
      result: {
        success: true,
        output: { ok: true },
        metadata: { duration: 12 },
      },
    })
    buildTraceSpansMock.mockReturnValue({
      traceSpans: [],
    })
    createWorkflowExecutionEventWriterMock.mockResolvedValue({
      write: writeExecutionEventMock,
    })
    writeExecutionEventMock.mockResolvedValue(undefined)
    isPendingWorkflowExecutionCancellationRequestedMock.mockResolvedValue(false)
    finalizeWorkflowExecutionMock.mockImplementation(async ({ result }) => result)
    completeWorkflowExecutionAttemptMock.mockResolvedValue(undefined)
  })

  it('marks queued workflow-block executions as child executions', async () => {
    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      metadata: {
        source: 'workflow_block',
        parentBlockId: 'block-1',
      },
    })

    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        actorUserId: 'user-1',
        contextExtensions: expect.objectContaining({
          workflowDepth: 0,
          isChildExecution: true,
          shouldCancelExecution: expect.any(Function),
        }),
      })
    )
  })

  it('does not mark non-child queued workflow executions as child executions', async () => {
    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      metadata: {
        source: 'workflow_queue',
      },
    })

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
  })

  it('enables chunk streaming only when requested by the queued payload', async () => {
    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      stream: true,
      selectedOutputs: ['agent-1_content'],
    })

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

    await executeWorkflowJob({
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
    })

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
    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'manual',
      metadata: {
        source: 'workflow_queue',
      },
    })

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
    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      executionId: 'execution-1',
    })

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

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'webhook',
      triggerBlockId: 'trigger-1',
      triggerData: {
        source: 'indicator_trigger',
        monitor: { id: 'monitor-1' },
      },
    })

    expect(disableMonitorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: 'monitor-1',
        provider: 'indicator',
        reason: 'usage_limit_exceeded',
        workflowId: 'workflow-1',
      })
    )
  })

  it('applies trigger adapters before the one canonical runner call', async () => {
    const prepare = vi.fn().mockResolvedValue({
      userId: 'prepared-user',
      workspaceId: 'prepared-workspace',
      input: { prepared: true },
    })
    const complete = vi.fn()

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: '',
      adapter: { prepare, complete },
    })

    expect(prepare).toHaveBeenCalledOnce()
    expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'prepared-user',
        workflowContext: { workspaceId: 'prepared-workspace', variables: undefined },
        workflowInput: { prepared: true },
      })
    )
    expect(complete).toHaveBeenCalledOnce()
  })

  it('returns the authoritative terminal winner for an adapter skip', async () => {
    const deadlineResult = {
      success: false,
      output: {},
      error: 'Workflow execution time limit exceeded',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
    }
    finalizeWorkflowExecutionMock.mockResolvedValueOnce(deadlineResult)
    const complete = vi.fn()

    const result = await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'user-1',
      adapter: {
        prepare: vi.fn().mockResolvedValue({
          skipResult: { success: true, output: { skipped: true } },
        }),
        complete,
      },
    })

    expect(result).toMatchObject(deadlineResult)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ result: deadlineResult }))
    expect(runWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('does not replace a finalized result when adapter settlement fails', async () => {
    const settlementError = new Error('adapter settlement failed')

    await expect(
      executeWorkflowJob({
        workflowId: 'workflow-1',
        userId: 'user-1',
        adapter: { complete: vi.fn().mockRejectedValue(settlementError) },
      })
    ).rejects.toBe(settlementError)

    expect(finalizeWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('keeps the background runner boundary exclusive to workflow-execution', () => {
    for (const file of [
      'schedule-execution.ts',
      'webhook-execution.ts',
      'portfolio-monitor-execution.ts',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toMatch(/run(?:Prepared)?WorkflowExecution\s*\(/)
    }
  })
})
