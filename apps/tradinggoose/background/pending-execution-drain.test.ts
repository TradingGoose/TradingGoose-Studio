/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'

const {
  dispatchQueuedDocumentProcessingJobMock,
  executeWorkflowJobMock,
  executeMonitorJobMock,
  executeScheduleJobMock,
  claimNextPendingExecutionMock,
  completePendingExecutionMock,
  failQueuedDocumentProcessingJobMock,
  executeWebhookJobMock,
  recoveryScopeRowsMock,
  wakePendingExecutionDrainMock,
  resolveServerExecutionBillingTierForScopeMock,
} = vi.hoisted(() => ({
  dispatchQueuedDocumentProcessingJobMock: vi.fn(),
  executeWorkflowJobMock: vi.fn(),
  executeMonitorJobMock: vi.fn(),
  executeScheduleJobMock: vi.fn(),
  claimNextPendingExecutionMock: vi.fn(),
  completePendingExecutionMock: vi.fn(),
  failQueuedDocumentProcessingJobMock: vi.fn(),
  executeWebhookJobMock: vi.fn(),
  recoveryScopeRowsMock: vi.fn(),
  wakePendingExecutionDrainMock: vi.fn(),
  resolveServerExecutionBillingTierForScopeMock: vi.fn(),
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  resolveServerExecutionBillingTierForScope: resolveServerExecutionBillingTierForScopeMock,
}))

vi.mock('@trigger.dev/sdk', () => ({
  schedules: { task: vi.fn((config) => config) },
  task: vi.fn((config) => config),
  timeout: { None: 'none' },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    selectDistinct: vi.fn(() => ({ from: recoveryScopeRowsMock })),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: { billingScopeId: 'pendingExecution.billingScopeId' },
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

vi.mock('./monitor-execution', () => ({
  executeMonitorJob: executeMonitorJobMock,
  isMonitorExecutionPayload: vi.fn(() => false),
}))

vi.mock('./schedule-execution', () => ({
  executeScheduleJob: executeScheduleJobMock,
  isScheduleExecutionPayload: vi.fn(() => false),
}))

vi.mock('./webhook-execution', () => ({
  executeWebhookJob: executeWebhookJobMock,
  isWebhookExecutionPayload: vi.fn(() => true),
}))

vi.mock('./workflow-execution', () => ({
  executeWorkflowJob: executeWorkflowJobMock,
  isWorkflowExecutionPayload: vi.fn(() => true),
}))

vi.mock('@/lib/execution/pending-execution-drain-wake', () => ({
  wakePendingExecutionDrain: wakePendingExecutionDrainMock,
}))

import { pendingExecutionDrain, pendingExecutionRecoverySweep } from './pending-execution-drain'

describe('pendingExecutionDrain', () => {
  const runPendingExecutionDrain = (billingScopeId: string) =>
    (
      pendingExecutionDrain as unknown as {
        run: (payload: { billingScopeId: string }) => Promise<unknown>
      }
    ).run({
      billingScopeId,
    })
  const runRecoverySweep = () =>
    (pendingExecutionRecoverySweep as unknown as { run: () => Promise<unknown> }).run()
  const executionRow = (id: string, executionType: string, payload: Record<string, unknown>) => ({
    id,
    billingScopeId: 'scope-1',
    billingScopeType: 'user',
    executionType,
    userId: 'user-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    payload,
    processingStartedAt: new Date('2026-04-23T00:00:00.000Z'),
  })
  const workflowRow = (id: string) =>
    executionRow(id, 'workflow', { workflowId: 'workflow-1', userId: 'user-1' })
  const expectedAttempt = expect.objectContaining({
    attemptStartedAt: '2026-04-23T00:00:00.000Z',
    fallbackActorUserId: 'user-1',
    fallbackWorkspaceId: 'workspace-1',
    timeBudget: expect.any(Object),
    timePolicy: {
      kind: 'unlimited',
      processingStartedAt: '2026-04-23T00:00:00.000Z',
      tier: { source: 'no-tier' },
    },
  })
  const webhookRow = (id: string) =>
    executionRow(id, 'webhook', {
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      provider: 'airtable',
      blockId: 'block-1',
    })

  beforeEach(() => {
    vi.clearAllMocks()
    claimNextPendingExecutionMock.mockResolvedValue({ status: 'empty' })
    dispatchQueuedDocumentProcessingJobMock.mockResolvedValue(undefined)
    executeWorkflowJobMock.mockResolvedValue(undefined)
    executeWebhookJobMock.mockResolvedValue(undefined)
    executeScheduleJobMock.mockResolvedValue(undefined)
    recoveryScopeRowsMock.mockResolvedValue([])
    wakePendingExecutionDrainMock.mockResolvedValue(undefined)
    resolveServerExecutionBillingTierForScopeMock.mockResolvedValue(null)
  })

  it('recovers a failed continuation admission through the queue heartbeat', async () => {
    let rejectAdmission!: (error: Error) => void
    executeWebhookJobMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectAdmission = reject
      })
    )
    claimNextPendingExecutionMock
      .mockResolvedValueOnce({ status: 'claimed', row: webhookRow('producer') })
      .mockResolvedValueOnce({ status: 'empty' })

    const failedDrain = runPendingExecutionDrain('scope-1')
    await vi.waitFor(() => expect(executeWebhookJobMock).toHaveBeenCalledOnce())
    expect(claimNextPendingExecutionMock).toHaveBeenCalledOnce()
    expect(completePendingExecutionMock).not.toHaveBeenCalled()
    rejectAdmission(new Error('continuation admission failed'))
    await expect(failedDrain).resolves.toEqual({
      success: false,
      pendingExecutionId: 'producer',
    })

    claimNextPendingExecutionMock
      .mockResolvedValueOnce({ status: 'claimed', row: webhookRow('producer') })
      .mockResolvedValueOnce({ status: 'claimed', row: webhookRow('continuation') })
      .mockResolvedValueOnce({ status: 'empty' })
    recoveryScopeRowsMock.mockResolvedValueOnce([{ billingScopeId: 'scope-1' }])
    wakePendingExecutionDrainMock.mockImplementationOnce(({ billingScopeId }) =>
      runPendingExecutionDrain(billingScopeId)
    )

    await expect(runRecoverySweep()).resolves.toEqual({ recoveredScopeCount: 1 })
    expect(executeWebhookJobMock.mock.calls.map(([payload]) => payload.executionId)).toEqual([
      'producer',
      'producer',
      'continuation',
    ])
    expect(executeWebhookJobMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ executionId: 'continuation' }),
      expectedAttempt
    )
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'continuation',
    })
  })

  it('keeps workflow rows active when execution infrastructure throws', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: workflowRow('pending-workflow-1'),
    })
    executeWorkflowJobMock.mockRejectedValueOnce(new Error('Workflow execution failed'))

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).not.toHaveBeenCalled()
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
        row: workflowRow('pending-workflow-2'),
      })
      .mockResolvedValueOnce({
        status: 'claimed',
        row: workflowRow('pending-workflow-3'),
      })

    const result = await runPendingExecutionDrain('scope-1')

    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-2',
    })
    expect(executeWorkflowJobMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executionId: 'pending-workflow-2',
      }),
      expectedAttempt
    )
    expect(completePendingExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'pending-workflow-3',
    })
    expect(executeWorkflowJobMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        executionId: 'pending-workflow-3',
      }),
      expectedAttempt
    )
    expect(claimNextPendingExecutionMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-3',
    })
  })

  it('reuses a nested workflow policy without resolving the claimed billing scope', async () => {
    const inheritedPolicy = {
      kind: 'bounded' as const,
      processingStartedAt: '2026-04-23T00:00:00.000Z',
      tier: {
        source: 'resolved-tier' as const,
        appliedTierId: 'tier-1',
        appliedTierName: 'Pro',
      },
      limitSeconds: 60,
      accounting: { mode: 'remaining' as const, remainingMilliseconds: 30_000 },
    }
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: executionRow('pending-child-1', 'workflow', {
        workflowId: 'workflow-child',
        userId: 'user-1',
        metadata: { source: 'workflow_block', timePolicy: inheritedPolicy },
      }),
    })

    await runPendingExecutionDrain('scope-1')

    expect(resolveServerExecutionBillingTierForScopeMock).not.toHaveBeenCalled()
    expect(executeWorkflowJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'pending-child-1' }),
      expect.objectContaining({
        attemptStartedAt: '2026-04-23T00:00:00.000Z',
        fallbackActorUserId: 'user-1',
        fallbackWorkspaceId: 'workspace-1',
        timeBudget: expect.any(Object),
        timePolicy: inheritedPolicy,
      })
    )
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
        ...executionRow('pending-document-1', 'document', payload),
        workflowId: null,
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
        ...executionRow('pending-indicator-1', 'monitor', {
          source: INDICATOR_MONITOR_PROVIDER,
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
        }),
        userId: 'actor-1',
      },
    })

    const { isMonitorExecutionPayload } = await import('./monitor-execution')
    vi.mocked(isMonitorExecutionPayload).mockReturnValue(true)
    executeMonitorJobMock.mockResolvedValue({ success: true })

    const result = await runPendingExecutionDrain('scope-1')

    expect(executeMonitorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'pending-indicator-1',
      }),
      undefined
    )
    expect(completePendingExecutionMock).toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      pendingExecutionId: 'pending-indicator-1',
    })
  })

  it('passes the processing-attempt start through schedule dispatch', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: executionRow('pending-schedule-1', 'schedule', {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
      }),
    })
    const { isScheduleExecutionPayload } = await import('./schedule-execution')
    vi.mocked(isScheduleExecutionPayload).mockReturnValue(true)

    await runPendingExecutionDrain('scope-1')

    expect(executeScheduleJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'pending-schedule-1' }),
      expectedAttempt
    )
  })

  it('captures portfolio workflow policy before monitor preprocessing', async () => {
    claimNextPendingExecutionMock.mockResolvedValueOnce({
      status: 'claimed',
      row: executionRow('pending-portfolio-1', 'monitor', {
        source: PORTFOLIO_MONITOR_PROVIDER,
      }),
    })
    const { isMonitorExecutionPayload } = await import('./monitor-execution')
    vi.mocked(isMonitorExecutionPayload).mockReturnValue(true)

    await runPendingExecutionDrain('scope-1')

    expect(resolveServerExecutionBillingTierForScopeMock).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      scopeType: 'user',
    })
    expect(resolveServerExecutionBillingTierForScopeMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeMonitorJobMock.mock.invocationCallOrder[0] ?? 0
    )
    expect(executeMonitorJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'pending-portfolio-1' }),
      expectedAttempt
    )
  })
})
