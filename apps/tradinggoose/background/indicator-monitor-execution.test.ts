/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndicatorMonitorExecutionPayload } from './indicator-monitor-execution'

const mocks = vi.hoisted(() => ({
  checkServerSideUsageLimits: vi.fn(),
  executeCompiledIndicator: vi.fn(),
  loadWorkflowExecutionBlueprint: vi.fn(),
  runPreparedWorkflowExecution: vi.fn(),
  withExecutionConcurrencyLimit: vi.fn(({ task }) => task()),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    update: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  webhook: {
    id: 'webhook.id',
    provider: 'webhook.provider',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
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

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: (...args: unknown[]) => mocks.checkServerSideUsageLimits(...args),
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  withExecutionConcurrencyLimit: (params: unknown) => mocks.withExecutionConcurrencyLimit(params),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/workflows/execution-runner', () => ({
  loadWorkflowExecutionBlueprint: (...args: unknown[]) =>
    mocks.loadWorkflowExecutionBlueprint(...args),
  runPreparedWorkflowExecution: (...args: unknown[]) => mocks.runPreparedWorkflowExecution(...args),
}))

const payload = {
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
    mocks.checkServerSideUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.executeCompiledIndicator.mockResolvedValue({
      output: {
        triggers: [{ event: 'cross', signal: 'buy', time: 1 }],
      },
    })
    mocks.loadWorkflowExecutionBlueprint.mockResolvedValue({
      workflowData: {
        blocks: { 'trigger-block': {} },
      },
    })
    mocks.runPreparedWorkflowExecution.mockResolvedValue({
      result: { success: true, output: { ok: true } },
    })
  })

  it('rejects missing workspace scope before concurrency and usage checks', async () => {
    const { executeIndicatorMonitorJob } = await import('./indicator-monitor-execution')

    await expect(
      executeIndicatorMonitorJob({
        ...payload,
        monitor: { ...payload.monitor, workspaceId: ' ' },
      })
    ).rejects.toThrow('Indicator monitor execution requires workspaceId')

    expect(mocks.withExecutionConcurrencyLimit).not.toHaveBeenCalled()
    expect(mocks.checkServerSideUsageLimits).not.toHaveBeenCalled()
  })

  it('passes the resolved workspace scope into concurrency, usage, and blueprint loading', async () => {
    const { executeIndicatorMonitorJob } = await import('./indicator-monitor-execution')

    await executeIndicatorMonitorJob(payload)

    expect(mocks.withExecutionConcurrencyLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
      })
    )
    expect(mocks.checkServerSideUsageLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
      })
    )
    expect(mocks.loadWorkflowExecutionBlueprint).toHaveBeenCalledWith({
      executionTarget: 'deployed',
      workflowContext: { workspaceId: 'workspace-1' },
      workflowId: 'workflow-1',
    })
  })
})
