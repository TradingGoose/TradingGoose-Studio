/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeWorkflowJobMock,
  executeIndicatorMonitorJobMock,
  claimNextPendingExecutionMock,
  completePendingExecutionMock,
  failPendingExecutionMock,
  retryPendingExecutionMock,
  triggerMock,
  waitForMock,
} = vi.hoisted(() => ({
  executeWorkflowJobMock: vi.fn(),
  executeIndicatorMonitorJobMock: vi.fn(),
  claimNextPendingExecutionMock: vi.fn(),
  completePendingExecutionMock: vi.fn(),
  failPendingExecutionMock: vi.fn(),
  retryPendingExecutionMock: vi.fn(),
  triggerMock: vi.fn(),
  waitForMock: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn((config) => ({
    ...config,
    trigger: triggerMock,
  })),
  wait: {
    for: waitForMock,
  },
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  claimNextPendingExecution: claimNextPendingExecutionMock,
  completePendingExecution: completePendingExecutionMock,
  failPendingExecution: failPendingExecutionMock,
  retryPendingExecution: retryPendingExecutionMock,
  PENDING_EXECUTION_DRAIN_TASK_ID: 'pending-execution-drain',
  PENDING_EXECUTION_RETRY_DELAY_MS: 15000,
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
  executeDocumentProcessingJob: vi.fn(),
  isDocumentProcessingPayload: vi.fn(() => false),
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
    (pendingExecutionDrain as unknown as {
      run: (payload: { billingScopeId: string }) => Promise<unknown>
    }).run({
      billingScopeId,
    })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks workflow jobs as failed when execution throws', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-workflow-1',
        executionType: 'workflow',
        payload: {
          workflowId: 'workflow-1',
          userId: 'user-1',
        },
      })
      .mockResolvedValueOnce(null)
    executeWorkflowJobMock.mockRejectedValue(new Error('Workflow execution failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(failPendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-1',
      errorMessage: 'Workflow execution failed',
    })
    expect(completePendingExecutionMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      pendingExecutionId: 'pending-workflow-1',
    })
  })

  it('drains successful rows without requiring a follow-up task trigger', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-workflow-2',
        executionType: 'workflow',
        payload: {
          workflowId: 'workflow-1',
          userId: 'user-1',
        },
      })
      .mockResolvedValueOnce(null)
    executeWorkflowJobMock.mockResolvedValue({
      success: true,
      executionId: 'pending-workflow-2',
      workflowId: 'workflow-1',
      output: { result: 1 },
    })

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-2',
      deleteOnSuccess: false,
      result: {
        success: true,
        executionId: 'pending-workflow-2',
        workflowId: 'workflow-1',
        output: { result: 1 },
      },
    })
    expect(failPendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-2',
    })
  })

  it('processes other ready rows before waiting on a deferred retry', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-workflow-3',
        executionType: 'workflow',
        payload: {
          workflowId: 'workflow-1',
          userId: 'user-1',
        },
      })
      .mockResolvedValueOnce({
        id: 'pending-workflow-4',
        executionType: 'workflow',
        payload: {
          workflowId: 'workflow-2',
          userId: 'user-1',
        },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    executeWorkflowJobMock
      .mockRejectedValueOnce(new Error('Service overloaded'))
      .mockResolvedValueOnce({
        success: true,
        executionId: 'pending-workflow-4',
        workflowId: 'workflow-2',
        output: { result: 2 },
      })

    const result = await runPendingExecutionDrain('scope-1')

    expect(retryPendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-3',
      errorMessage: 'Service overloaded',
      delayMs: 15000,
    })
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-4',
      deleteOnSuccess: false,
      result: {
        success: true,
        executionId: 'pending-workflow-4',
        workflowId: 'workflow-2',
        output: { result: 2 },
      },
    })
    expect(
      completePendingExecutionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(waitForMock.mock.invocationCallOrder[0])
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-4',
      skipped: 'deferred',
    })
  })

  it('drains indicator monitor rows through the shared worker contract', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-indicator-1',
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
      .mockResolvedValueOnce(null)

    const {
      isIndicatorMonitorExecutionPayload,
    } = await import('./indicator-monitor-execution')
    vi.mocked(isIndicatorMonitorExecutionPayload).mockReturnValue(true)
    executeIndicatorMonitorJobMock.mockResolvedValue({ success: true })

    const result = await runPendingExecutionDrain('scope-1')

    expect(executeIndicatorMonitorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'pending-indicator-1',
      }),
    )
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-indicator-1',
    })
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-indicator-1',
    })
  })
})
