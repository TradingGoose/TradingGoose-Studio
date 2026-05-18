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
  retryPendingExecutionMock,
  triggerPendingExecutionDrainMock,
  triggerMock,
} = vi.hoisted(() => ({
  dispatchQueuedDocumentProcessingJobMock: vi.fn(),
  executeWorkflowJobMock: vi.fn(),
  executeIndicatorMonitorJobMock: vi.fn(),
  claimNextPendingExecutionMock: vi.fn(),
  completePendingExecutionMock: vi.fn(),
  failQueuedDocumentProcessingJobMock: vi.fn(),
  retryPendingExecutionMock: vi.fn(),
  triggerPendingExecutionDrainMock: vi.fn(),
  triggerMock: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config) => ({
    ...config,
    trigger: triggerMock,
  })),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  claimNextPendingExecution: claimNextPendingExecutionMock,
  completePendingExecution: completePendingExecutionMock,
  retryPendingExecution: retryPendingExecutionMock,
  triggerPendingExecutionDrain: triggerPendingExecutionDrainMock,
  PENDING_EXECUTION_DRAIN_TASK_ID: 'pending-execution-drain',
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  isExecutionConcurrencyLimitError: vi.fn(() => false),
  isExecutionConcurrencyBackendUnavailableError: vi.fn(() => false),
}))

vi.mock('@/lib/execution/local-saturation-limit', () => ({
  isLocalVmSaturationLimitError: vi.fn(() => false),
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
    dispatchQueuedDocumentProcessingJobMock.mockResolvedValue(undefined)
    executeWorkflowJobMock.mockResolvedValue(undefined)
    triggerPendingExecutionDrainMock.mockResolvedValue(undefined)
  })

  it('removes failed workflow jobs after execution throws', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      id: 'pending-workflow-1',
      billingScopeId: 'scope-1',
      executionType: 'workflow',
      payload: {
        workflowId: 'workflow-1',
        userId: 'user-1',
      },
    })
    executeWorkflowJobMock.mockRejectedValueOnce(new Error('Workflow execution failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-1',
    })
    expect(triggerPendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'scope-1',
    })
    expect(result).toEqual({
      success: false,
      pendingExecutionId: 'pending-workflow-1',
    })
  })

  it('drains one successful row and wakes the next drain', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      id: 'pending-workflow-2',
      billingScopeId: 'scope-1',
      executionType: 'workflow',
      payload: {
        workflowId: 'workflow-1',
        userId: 'user-1',
      },
    })

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-2',
    })
    expect(triggerPendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'scope-1',
    })
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-2',
    })
  })

  it('marks documents failed when document dispatch fails terminally', async () => {
    const payload = { documentId: 'doc-1' }
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      id: 'pending-document-1',
      billingScopeId: 'scope-1',
      executionType: 'document',
      payload,
    })
    dispatchQueuedDocumentProcessingJobMock.mockRejectedValueOnce(new Error('PDF parse failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(failQueuedDocumentProcessingJobMock).toHaveBeenCalledWith(payload, 'PDF parse failed')
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-document-1',
    })
    expect(triggerPendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'scope-1',
    })
    expect(result).toEqual({
      success: false,
      pendingExecutionId: 'pending-document-1',
    })
  })

  it('releases transiently blocked rows without sleeping in the drain task', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      id: 'pending-workflow-3',
      billingScopeId: 'scope-1',
      executionType: 'workflow',
      payload: {
        workflowId: 'workflow-1',
        userId: 'user-1',
      },
    })
    executeWorkflowJobMock.mockRejectedValueOnce(new Error('Service overloaded'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(retryPendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-3',
      errorMessage: 'Service overloaded',
    })
    expect(completePendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerPendingExecutionDrainMock).not.toHaveBeenCalled()
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-3',
      skipped: 'deferred',
    })
  })

  it('drains indicator monitor rows through the shared worker contract', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      id: 'pending-indicator-1',
      billingScopeId: 'scope-1',
      executionType: 'indicator_monitor',
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
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-indicator-1',
    })
    expect(triggerPendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'scope-1',
    })
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-indicator-1',
    })
  })
})
