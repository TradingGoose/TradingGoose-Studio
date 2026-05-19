/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dispatchQueuedDocumentProcessingJobMock,
  executeWorkflowJobMock,
  executeIndicatorMonitorJobMock,
  claimNextPendingExecutionMock,
  completePendingExecutionMock,
  failQueuedDocumentProcessingJobMock,
} = vi.hoisted(() => ({
  dispatchQueuedDocumentProcessingJobMock: vi.fn(),
  executeWorkflowJobMock: vi.fn(),
  executeIndicatorMonitorJobMock: vi.fn(),
  claimNextPendingExecutionMock: vi.fn(),
  completePendingExecutionMock: vi.fn(),
  failQueuedDocumentProcessingJobMock: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config) => config),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  claimNextPendingExecution: claimNextPendingExecutionMock,
  completePendingExecution: completePendingExecutionMock,
  PENDING_EXECUTION_DRAIN_TASK_ID: 'pending-execution-drain',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('./knowledge-processing', () => ({
  dispatchQueuedDocumentProcessingJob: dispatchQueuedDocumentProcessingJobMock,
  failQueuedDocumentProcessingJob: failQueuedDocumentProcessingJobMock,
}))

vi.mock('./indicator-monitor-execution', () => ({
  executeIndicatorMonitorJob: executeIndicatorMonitorJobMock,
  isIndicatorMonitorExecutionPayload: vi.fn(() => false),
}))

vi.mock('./schedule-execution', () => ({
  executeScheduleJob: vi.fn(),
  isScheduleExecutionPayload: vi.fn(() => false),
}))

vi.mock('./webhook-execution', () => ({
  executeWebhookJob: vi.fn(),
  isWebhookExecutionPayload: vi.fn(() => false),
}))

vi.mock('./workflow-execution', () => ({
  executeWorkflowJob: executeWorkflowJobMock,
  isWorkflowExecutionPayload: vi.fn(() => true),
}))

import { pendingExecutionDrain } from './pending-execution-drain'

describe('pendingExecutionDrain', () => {
  const runPendingExecutionDrain = (billingScopeId: string) =>
    (
      pendingExecutionDrain as unknown as {
        run: (payload: { billingScopeId: string }) => Promise<unknown>
      }
    ).run({
      billingScopeId,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    claimNextPendingExecutionMock.mockResolvedValue({ status: 'empty' })
    dispatchQueuedDocumentProcessingJobMock.mockResolvedValue(undefined)
    executeWorkflowJobMock.mockResolvedValue(undefined)
  })

  it('removes failed workflow jobs after execution throws', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: {
        id: 'pending-workflow-1',
        billingScopeId: 'scope-1',
        billingScopeType: 'user',
        executionType: 'workflow',
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        payload: {
          workflowId: 'workflow-1',
          userId: 'user-1',
        },
      },
    })
    executeWorkflowJobMock.mockRejectedValueOnce(new Error('Workflow execution failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalled()
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      success: false,
      pendingExecutionId: 'pending-workflow-1',
    })
  })

  it('drains successful rows until the scope is empty', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        status: 'claimed',
        row: {
          id: 'pending-workflow-2',
          billingScopeId: 'scope-1',
          billingScopeType: 'user',
          executionType: 'workflow',
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          payload: {
            workflowId: 'workflow-1',
            userId: 'user-1',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 'claimed',
        row: {
          id: 'pending-workflow-3',
          billingScopeId: 'scope-1',
          billingScopeType: 'user',
          executionType: 'workflow',
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          payload: {
            workflowId: 'workflow-1',
            userId: 'user-1',
          },
        },
      })

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-2',
    })
    expect(executeWorkflowJobMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executionId: 'pending-workflow-2',
      })
    )
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-3',
    })
    expect(executeWorkflowJobMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        executionId: 'pending-workflow-3',
      })
    )
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-3',
    })
  })

  it('returns when the scope is at capacity', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'capacity_blocked',
      pendingExecutionId: 'pending-workflow-3',
    })

    const result = await runPendingExecutionDrain('scope-1')

    expect(executeWorkflowJobMock).not.toHaveBeenCalled()
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(1)
    expect(completePendingExecutionMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-3',
    })
  })

  it('marks documents failed when document dispatch fails terminally', async () => {
    const payload = { documentId: 'doc-1' }
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: {
        id: 'pending-document-1',
        billingScopeId: 'scope-1',
        billingScopeType: 'user',
        executionType: 'document',
        userId: 'user-1',
        workflowId: null,
        workspaceId: 'workspace-1',
        payload,
      },
    })
    dispatchQueuedDocumentProcessingJobMock.mockRejectedValueOnce(new Error('PDF parse failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(dispatchQueuedDocumentProcessingJobMock).toHaveBeenCalledWith(payload)
    expect(failQueuedDocumentProcessingJobMock).toHaveBeenCalledWith(payload, 'PDF parse failed')
    expect(completePendingExecutionMock).toHaveBeenCalled()
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      success: false,
      pendingExecutionId: 'pending-document-1',
    })
  })

  it('drains indicator monitor rows through the shared worker contract', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: {
        id: 'pending-indicator-1',
        billingScopeId: 'scope-1',
        billingScopeType: 'user',
        executionType: 'indicator_monitor',
        userId: 'actor-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        payload: {
          monitor: {
            id: 'monitor-1',
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            actorUserId: 'actor-1',
            blockId: 'block-1',
            providerId: 'alpaca',
            interval: '1m',
            intervalMs: 60_000,
            indicatorId: 'indicator-1',
            listing: {
              listing_id: 'AAPL',
              base_id: 'AAPL',
              quote_id: 'USD',
              listing_type: 'default',
            },
          },
          indicator: {
            id: 'indicator-1',
            name: 'Indicator',
            pineCode: 'plot(close)',
          },
          inputsMap: {},
          bars: [],
        },
      },
    })

    const { isIndicatorMonitorExecutionPayload } = await import('./indicator-monitor-execution')
    vi.mocked(isIndicatorMonitorExecutionPayload).mockReturnValue(true)
    executeIndicatorMonitorJobMock.mockResolvedValue({ success: true })

    const result = await runPendingExecutionDrain('scope-1')

    expect(executeIndicatorMonitorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'pending-indicator-1',
      })
    )
    expect(completePendingExecutionMock).toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-indicator-1',
    })
  })
})
