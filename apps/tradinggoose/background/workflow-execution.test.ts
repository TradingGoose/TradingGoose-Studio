/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runWorkflowExecutionMock,
  buildTraceSpansMock,
  createWorkflowExecutionEventWriterMock,
  writeExecutionEventMock,
  isPendingWorkflowExecutionCancellationRequestedMock,
} = vi.hoisted(() => ({
  runWorkflowExecutionMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  createWorkflowExecutionEventWriterMock: vi.fn(),
  writeExecutionEventMock: vi.fn(),
  isPendingWorkflowExecutionCancellationRequestedMock: vi.fn(),
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

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: buildTraceSpansMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
  })),
}))

import { executeWorkflowJob } from './workflow-execution'

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
    expect(createWorkflowExecutionEventWriterMock).toHaveBeenCalledWith({
      pendingExecutionId: expect.any(String),
      workflowId: 'workflow-1',
    })
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
      startBlockId: 'trigger-1',
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
        start: {
          kind: 'block',
          blockId: 'trigger-1',
        },
      })
    )
  })

  it('preserves manual queued starts when no explicit start block is supplied', async () => {
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
        start: {
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
})
