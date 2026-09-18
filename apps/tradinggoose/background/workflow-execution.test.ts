/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runWorkflowExecutionMock,
  runPreparedWorkflowExecutionMock,
  claimWorkflowCheckpointMock,
  buildTraceSpansMock,
  createWorkflowExecutionEventWriterMock,
  writeExecutionEventMock,
  isPendingWorkflowExecutionCancellationRequestedMock,
  disableMonitorMock,
} = vi.hoisted(() => ({
  runWorkflowExecutionMock: vi.fn(),
  runPreparedWorkflowExecutionMock: vi.fn(),
  claimWorkflowCheckpointMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  createWorkflowExecutionEventWriterMock: vi.fn(),
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
vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  claimWorkflowCheckpoint: claimWorkflowCheckpointMock,
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

const workflowJob = { workflowId: 'workflow-1', userId: 'user-1' }
const resumeJob = {
  ...workflowJob,
  executionId: 'resume-job-2',
  resumeExecutionId: 'original-execution',
  checkpointRevision: 2,
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
    claimWorkflowCheckpointMock.mockResolvedValue(null)
    runPreparedWorkflowExecutionMock.mockResolvedValue({
      result: { success: true, output: { resumed: true }, logs: [] },
    })
  })

  it.each([
    { source: 'workflow_block', parentBlockId: 'block-1', isChildExecution: true },
    { source: 'workflow_queue', isChildExecution: false },
  ])(
    'classifies queued $source executions correctly',
    async ({ isChildExecution, ...metadata }) => {
      await executeWorkflowJob({ ...workflowJob, executionId: 'initial-execution', metadata })

      expect(runWorkflowExecutionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-1',
          actorUserId: 'user-1',
          contextExtensions: expect.objectContaining({
            pendingExecutionId: 'initial-execution',
            workflowDepth: 0,
            isChildExecution,
            shouldCancelExecution: expect.any(Function),
            stream: false,
          }),
        })
      )
      expect(createWorkflowExecutionEventWriterMock).not.toHaveBeenCalled()
    }
  )

  it('enables chunk streaming only when requested by the queued payload', async () => {
    await executeWorkflowJob({
      ...workflowJob,
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
      ...workflowJob,
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
      ...workflowJob,
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
    await executeWorkflowJob({ ...workflowJob, executionId: 'execution-1' })

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
      ...workflowJob,
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

  const resumed = {
    executionId: 'original-execution',
    workflowId: 'workflow-1',
    userId: 'user-1',
    snapshot: {
      blueprint: {
        workflowId: 'workflow-1',
        executionTarget: 'deployed',
        workflowContext: { workspaceId: 'original-workspace', variables: {} },
        workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
      },
      workflowInput: { original: true },
      triggerType: 'webhook',
      triggerData: { originalSource: 'webhook' },
      workflowLogId: 'original-log',
      executor: {
        context: {
          triggerBlockId: 'saved-trigger',
          workflowDepth: 2,
          stream: true,
          selectedOutputs: ['saved-output'],
        },
      },
    },
    pausePoints: [{ id: 'review', input: { approved: true } }],
  }

  it('resumes webhook checkpoints with the saved trigger and original execution identity', async () => {
    claimWorkflowCheckpointMock.mockResolvedValueOnce(resumed)
    await executeWorkflowJob({
      ...resumeJob,
      input: { changed: true },
      triggerType: 'manual',
      executionTarget: 'live',
      workflowData: { blocks: { changed: {} }, edges: [], loops: {}, parallels: {} },
      selectedOutputs: ['changed-output'],
    })

    expect(claimWorkflowCheckpointMock).toHaveBeenCalledExactlyOnceWith({
      executionId: 'original-execution',
      revision: 2,
      jobId: 'resume-job-2',
    })
    expect(runWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(runPreparedWorkflowExecutionMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        blueprint: resumed.snapshot.blueprint,
        resume: resumed,
        actorUserId: 'user-1',
        executionId: 'original-execution',
        executionTarget: 'deployed',
        workflowInput: { original: true },
        triggerType: 'webhook',
        triggerTarget: { kind: 'block', blockId: 'saved-trigger' },
        triggerData: { originalSource: 'webhook' },
        contextExtensions: expect.objectContaining({
          stream: true,
          isChildExecution: true,
          pendingExecutionId: 'resume-job-2',
          selectedOutputs: ['saved-output'],
        }),
      })
    )
    expect(createWorkflowExecutionEventWriterMock).toHaveBeenCalledWith({
      pendingExecutionId: 'original-execution',
      workflowId: 'workflow-1',
    })
    const params = runPreparedWorkflowExecutionMock.mock.calls[0][0]
    await params.contextExtensions.shouldCancelExecution()
    expect(isPendingWorkflowExecutionCancellationRequestedMock).toHaveBeenCalledWith('resume-job-2')
  })

  it('does not execute a revision that another job already claimed', async () => {
    await expect(executeWorkflowJob(resumeJob)).resolves.toEqual({
      success: true,
      skipped: 'checkpoint_already_claimed',
    })
    expect(runWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(runPreparedWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(createWorkflowExecutionEventWriterMock).not.toHaveBeenCalled()
  })

  it.each([{ workflowId: 'another-workflow' }, { userId: 'another-user' }])(
    'rejects a claimed checkpoint with mismatched ownership %j',
    async (mismatch) => {
      claimWorkflowCheckpointMock.mockResolvedValueOnce({ ...resumed, ...mismatch })
      await expect(executeWorkflowJob(resumeJob)).rejects.toThrow(
        'Resume execution scope does not match its checkpoint'
      )
      expect(runPreparedWorkflowExecutionMock).not.toHaveBeenCalled()
      expect(createWorkflowExecutionEventWriterMock).not.toHaveBeenCalled()
    }
  )

  it('does not duplicate the pause event emitted by the runner or emit terminal completion', async () => {
    const pausedResult = {
      success: true,
      status: 'paused',
      output: { revision: 2, url: '/review' },
      logs: [],
    }
    runWorkflowExecutionMock.mockImplementationOnce(async (params) => {
      await params.contextExtensions.onExecutionEvent({
        type: 'execution:paused',
        data: { result: pausedResult },
      })
      return { result: pausedResult }
    })

    const result = await executeWorkflowJob({
      ...workflowJob,
      executionId: 'execution-1',
      stream: true,
    })

    expect(result).toMatchObject({ status: 'paused' })
    expect(writeExecutionEventMock.mock.calls.map(([event]) => event.type)).toEqual([
      'execution:started',
      'execution:paused',
    ])
  })
})
