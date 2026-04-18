/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runWorkflowExecutionMock,
  buildTraceSpansMock,
} = vi.hoisted(() => ({
  runWorkflowExecutionMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
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
        }),
      }),
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
        }),
      }),
    )
  })
})
