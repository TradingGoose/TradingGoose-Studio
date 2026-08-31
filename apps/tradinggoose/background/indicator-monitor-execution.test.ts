/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import type { IndicatorMonitorExecutionPayload } from './indicator-monitor-execution'

const mocks = vi.hoisted(() => ({
  enqueuePendingExecution: vi.fn(),
  executeCompiledIndicator: vi.fn(),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: (...args: unknown[]) => mocks.enqueuePendingExecution(...args),
  isPendingExecutionLimitError: (error: { code?: string }) =>
    error?.code === 'PENDING_EXECUTION_LIMIT',
}))

vi.mock('@/lib/indicators/dispatch', () => ({
  applyIndicatorTriggerPayloadBudget: vi.fn((payload) => ({
    metadata: {
      finalSizeBytes: 100,
      originalSizeBytes: 100,
      retainedBars: 1,
      truncated: false,
    },
    payload,
    skipped: false,
  })),
  buildIndicatorTriggerDispatchPayload: vi.fn((payload) => payload),
  buildLiveIndicatorTriggerEventId: vi.fn(() => 'event-1'),
  resolveLatestBarOpenTimeSec: vi.fn(() => 1),
}))

vi.mock('@/lib/indicators/execution/compile-execution', () => ({
  executeCompiledIndicator: (...args: unknown[]) => mocks.executeCompiledIndicator(...args),
}))

vi.mock('@/lib/indicators/series-data', () => ({
  normalizeBarsMs: vi.fn((bars) => bars),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

const payload = {
  source: INDICATOR_MONITOR_PROVIDER,
  monitor: {
    id: 'monitor-1',
    workflowId: 'workflow-1',
    workspaceId: ' workspace-1 ',
    userId: 'user-1',
    actorUserId: 'actor-1',
    blockId: 'trigger-block',
    providerId: 'alpaca',
    interval: '1m',
    intervalMs: 60_000,
    indicatorId: 'indicator-1',
    assetType: 'stock',
    listing: {
      listing_type: 'default',
      listing_id: 'AAPL',
      base_id: 'AAPL',
      quote_id: 'USD',
    },
  },
  indicator: {
    id: 'indicator-1',
    name: 'RSI',
    pineCode: 'plot(close)',
  },
  inputsMap: {},
  bars: [{ close: 1, closeTime: 2000, high: 1, low: 1, open: 1, openTime: 1000, volume: 1 }],
} satisfies IndicatorMonitorExecutionPayload

describe('executeIndicatorMonitorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enqueuePendingExecution.mockResolvedValue({
      billingScopeId: 'workspace-1',
      inserted: true,
      pendingExecutionId: 'event-1',
    })
    mocks.executeCompiledIndicator.mockResolvedValue({
      output: {
        triggers: [{ event: 'cross', signal: 'buy', time: 1 }],
      },
    })
  })

  it('rejects missing workspace scope before queueing workflow execution', async () => {
    const { executeIndicatorMonitorJob } = await import('./indicator-monitor-execution')

    await expect(
      executeIndicatorMonitorJob({
        ...payload,
        monitor: { ...payload.monitor, workspaceId: ' ' },
      })
    ).rejects.toThrow('Indicator monitor execution requires workspaceId')

    expect(mocks.enqueuePendingExecution).not.toHaveBeenCalled()
  })

  it('queues triggered workflow execution with the indicator event as the workflow dedupe key', async () => {
    const { executeIndicatorMonitorJob } = await import('./indicator-monitor-execution')

    const result = await executeIndicatorMonitorJob(payload)

    expect(result).toMatchObject({
      success: true,
      executionId: 'event-1',
    })
    expect(mocks.enqueuePendingExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'workflow',
        pendingExecutionId: 'event-1',
        orderingKey: 'monitor:monitor-1',
        source: 'monitor:indicator',
        workspaceId: 'workspace-1',
        payload: expect.objectContaining({
          executionId: 'event-1',
          workflowId: 'workflow-1',
          userId: 'actor-1',
          workspaceId: 'workspace-1',
          triggerType: 'webhook',
          executionTarget: 'deployed',
          triggerBlockId: 'trigger-block',
          triggerData: expect.objectContaining({
            monitor: expect.objectContaining({ assetType: 'stock' }),
          }),
        }),
      })
    )
  })

  it('completes indicator calculation when the workflow backlog is full', async () => {
    const { executeIndicatorMonitorJob } = await import('./indicator-monitor-execution')
    mocks.enqueuePendingExecution.mockRejectedValueOnce({
      code: 'PENDING_EXECUTION_LIMIT',
      details: {
        pendingCount: 100,
        maxPendingCount: 100,
      },
    })

    const result = await executeIndicatorMonitorJob(payload)

    expect(result).toMatchObject({
      success: true,
      skipped: 'workflow_backlog_full',
      executionId: 'event-1',
    })
  })
})
