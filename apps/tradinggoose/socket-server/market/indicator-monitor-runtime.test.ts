/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireLockMock,
  renewLockMock,
  releaseLockMock,
  getRedisClientMock,
  getRedisStorageModeMock,
  dbSelectMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  renewLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  getRedisClientMock: vi.fn(() => ({})),
  getRedisStorageModeMock: vi.fn(() => 'redis'),
  dbSelectMock: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: dbSelectMock,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pineIndicators: {
    id: 'pineIndicators.id',
    workspaceId: 'pineIndicators.workspaceId',
    name: 'pineIndicators.name',
    pineCode: 'pineIndicators.pineCode',
    inputMeta: 'pineIndicators.inputMeta',
  },
  webhook: {
    id: 'webhook.id',
    provider: 'webhook.provider',
    isActive: 'webhook.isActive',
  },
  workflow: {
    id: 'workflow.id',
    userId: 'workflow.userId',
    workspaceId: 'workflow.workspaceId',
    pinnedApiKeyId: 'workflow.pinnedApiKeyId',
    isDeployed: 'workflow.isDeployed',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  inArray: vi.fn(() => 'inArray'),
}))

vi.mock('@/lib/api-key/service', () => ({
  getApiKeyOwnerUserId: vi.fn(),
}))

vi.mock('@/lib/billing', () => ({
  checkServerSideUsageLimits: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: vi.fn(),
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  ExecutionGateError: class ExecutionGateError extends Error {},
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: vi.fn(),
  isPendingExecutionLimitError: vi.fn(() => false),
}))

vi.mock('@/lib/indicators/default/runtime', () => ({
  DEFAULT_INDICATOR_RUNTIME_MAP: new Map(),
}))

vi.mock('@/lib/indicators/dispatch', () => ({
  resolveDispatchIntervalMs: vi.fn(() => 60_000),
}))

vi.mock('@/lib/indicators/input-meta', () => ({
  buildInputsMapFromMeta: vi.fn(() => ({})),
  normalizeInputMetaMap: vi.fn(() => ({})),
}))

vi.mock('@/lib/indicators/monitor-config', () => ({
  INDICATOR_MONITOR_TRIGGER_ID: 'indicator-monitor',
}))

vi.mock('@/lib/indicators/series-data', () => ({
  mapMarketBarToBarMs: vi.fn(),
  mapMarketSeriesToBarsMs: vi.fn(() => []),
  normalizeBarsMs: vi.fn(() => []),
}))

vi.mock('@/lib/indicators/trigger-detection', () => ({
  isIndicatorTriggerCapable: vi.fn(() => true),
}))

vi.mock('@/lib/listing/identity', () => ({
  toListingValueObject: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  acquireLock: acquireLockMock,
  renewLock: renewLockMock,
  releaseLock: releaseLockMock,
  getRedisClient: getRedisClientMock,
  getRedisStorageMode: getRedisStorageModeMock,
}))

vi.mock('@/lib/trigger/settings', () => ({
  TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {},
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: vi.fn(),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  blockExistsInDeployment: vi.fn(() => true),
}))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: vi.fn(),
}))

vi.mock('@/providers/market/alpaca/config', () => ({
  alpacaProviderConfig: {},
}))

vi.mock('@/providers/market/finnhub/config', () => ({
  finnhubProviderConfig: {},
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: vi.fn(),
  resolveProviderSymbol: vi.fn(),
}))

vi.mock('@/socket-server/market/manager', () => ({
  marketStreamManager: {
    subscribe: vi.fn(),
    removeSocket: vi.fn(),
  },
}))

import { IndicatorMonitorRuntime } from './indicator-monitor-runtime'

function buildEmptyMonitorQuery() {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  }
}

describe('IndicatorMonitorRuntime lock lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    acquireLockMock.mockResolvedValue(true)
    renewLockMock.mockResolvedValue(true)
    releaseLockMock.mockResolvedValue(true)
    getRedisClientMock.mockReturnValue({})
    getRedisStorageModeMock.mockReturnValue('redis')
    dbSelectMock.mockImplementation(() => buildEmptyMonitorQuery())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires a short-lived lock and renews it while running', async () => {
    const runtime = new IndicatorMonitorRuntime({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })

    await runtime.start()

    expect(acquireLockMock).toHaveBeenCalledWith(
      'indicator-monitor-runtime-lock',
      expect.any(String),
      90,
    )
    expect(runtime.getHealth().status).toBe('running')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(renewLockMock).toHaveBeenCalledWith(
      'indicator-monitor-runtime-lock',
      expect.any(String),
      90,
    )

    await runtime.stop()
  })

  it('drops into degraded mode when lock renewal fails', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const runtime = new IndicatorMonitorRuntime(logger)

    renewLockMock.mockResolvedValueOnce(false)

    await runtime.start()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(runtime.getHealth()).toMatchObject({
      enabled: false,
      status: 'degraded',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Indicator monitor paused; runtime unavailable',
      expect.objectContaining({
        reason: 'lock',
      }),
    )

    await runtime.stop()
  })

  it('releases the lock and clears renewal timers on stop', async () => {
    const runtime = new IndicatorMonitorRuntime({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })

    await runtime.start()
    await runtime.stop()

    expect(releaseLockMock).toHaveBeenCalledWith(
      'indicator-monitor-runtime-lock',
      expect.any(String),
    )

    const renewCallCount = renewLockMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(renewLockMock).toHaveBeenCalledTimes(renewCallCount)
  })
})
