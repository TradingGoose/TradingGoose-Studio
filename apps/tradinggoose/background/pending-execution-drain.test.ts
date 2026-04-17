/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeFunctionRequestMock,
  claimNextPendingExecutionMock,
  completePendingExecutionMock,
  failPendingExecutionMock,
  retryPendingExecutionMock,
  triggerMock,
  waitForMock,
} = vi.hoisted(() => ({
  executeFunctionRequestMock: vi.fn(),
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

vi.mock('@/lib/function/execution', () => ({
  executeFunctionRequest: executeFunctionRequestMock,
  isFunctionExecutionPayload: vi.fn(() => true),
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

vi.mock('./schedule-execution', () => ({
  executeScheduleJob: vi.fn(),
  isScheduleExecutionPayload: vi.fn(() => false),
}))

vi.mock('./webhook-execution', () => ({
  executeWebhookJob: vi.fn(),
  isWebhookExecutionPayload: vi.fn(() => false),
}))

vi.mock('./workflow-execution', () => ({
  executeWorkflowJob: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(() => false),
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

  it('marks async function jobs as failed when execution returns success=false', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-function-1',
        executionType: 'function',
        payload: {
          userId: 'user-1',
          code: 'return 1',
        },
      })
      .mockResolvedValueOnce(null)
    executeFunctionRequestMock.mockResolvedValue({
      statusCode: 500,
      body: {
        success: false,
        error: 'Function execution failed',
        output: {
          result: null,
          stdout: '',
          executionTime: 10,
        },
      },
    })

    const result = await runPendingExecutionDrain('scope-1')

    expect(failPendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-function-1',
      errorMessage: 'Function execution failed',
    })
    expect(completePendingExecutionMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-function-1',
    })
  })

  it('drains successful rows without requiring a follow-up task trigger', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-function-2',
        executionType: 'function',
        payload: {
          userId: 'user-1',
          code: 'return 1',
        },
      })
      .mockResolvedValueOnce(null)
    executeFunctionRequestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        success: true,
        output: {
          result: 1,
          stdout: '',
          executionTime: 10,
        },
      },
    })

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-function-2',
      deleteOnSuccess: false,
      result: {
        success: true,
        output: {
          result: 1,
          stdout: '',
          executionTime: 10,
        },
        statusCode: 200,
      },
    })
    expect(failPendingExecutionMock).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-function-2',
    })
  })

  it('processes other ready rows before waiting on a deferred retry', async () => {
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({
        id: 'pending-function-3',
        executionType: 'function',
        payload: {
          userId: 'user-1',
          code: 'return 1',
        },
      })
      .mockResolvedValueOnce({
        id: 'pending-function-4',
        executionType: 'function',
        payload: {
          userId: 'user-1',
          code: 'return 2',
        },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    executeFunctionRequestMock
      .mockRejectedValueOnce(new Error('Service overloaded'))
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          success: true,
          output: {
            result: 2,
            stdout: '',
            executionTime: 10,
          },
        },
      })

    const result = await runPendingExecutionDrain('scope-1')

    expect(retryPendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-function-3',
      errorMessage: 'Service overloaded',
      delayMs: 15000,
    })
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-function-4',
      deleteOnSuccess: false,
      result: {
        success: true,
        output: {
          result: 2,
          stdout: '',
          executionTime: 10,
        },
        statusCode: 200,
      },
    })
    expect(
      completePendingExecutionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(waitForMock.mock.invocationCallOrder[0])
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-function-4',
      skipped: 'deferred',
    })
  })
})
