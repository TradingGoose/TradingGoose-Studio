/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeProviderRequest } from '@/providers/market'
import { marketStreamManager } from '@/socket-server/market/manager'

const {
  acquireLockMock,
  renewLockMock,
  releaseLockMock,
  getRedisClientMock,
  getRedisStorageModeMock,
  dbSelectMock,
  dbUpdateSetMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  renewLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  getRedisClientMock: vi.fn(() => ({})),
  getRedisStorageModeMock: vi.fn(() => 'redis'),
  dbSelectMock: vi.fn(),
  dbUpdateSetMock: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: dbSelectMock,
    update: () => ({ set: dbUpdateSetMock }),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pineIndicators: {
    id: 'pineIndicators.id',
    workspaceId: 'pineIndicators.workspaceId',
    name: 'pineIndicators.name',
    pineCode: 'pineIndicators.pineCode',
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
  getApiKeyOwnerUserId: vi.fn().mockResolvedValue('billing-user'),
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
  DEFAULT_INDICATOR_RUNTIME_MAP: new Map([['rsi', { name: 'RSI', pineCode: '' }]]),
}))

vi.mock('@/lib/indicators/dispatch', () => ({
  resolveDispatchIntervalMs: vi.fn(() => 60_000),
}))

vi.mock('@/lib/indicators/input-meta', () => ({
  buildInputsMapFromMeta: vi.fn(() => ({})),
  inferInputMetaFromPineCode: vi.fn(() => ({})),
}))

vi.mock('@/lib/indicators/series-data', () => ({
  mapMarketBarToBarMs: vi.fn(),
  mapMarketSeriesToBarsMs: vi.fn(() => []),
  normalizeBarsMs: vi.fn(() => []),
}))

vi.mock('@/lib/redis', () => ({
  acquireLock: acquireLockMock,
  renewLock: renewLockMock,
  releaseLock: releaseLockMock,
  getRedisClient: getRedisClientMock,
  getRedisStorageMode: getRedisStorageModeMock,
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: vi.fn(),
}))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: vi.fn(),
}))

vi.mock('@/providers/market/providers', () => ({
  getMarketProviderConfig: vi.fn(() => ({})),
  getMarketProviderDefinition: (id: string) =>
    id === 'robinhood' ? { oauth: { provider: 'robinhood' } } : {},
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: vi.fn().mockResolvedValue({ assetClass: 'stock' }),
  resolveProviderSymbol: vi.fn(() => 'AAPL'),
}))

vi.mock('@/socket-server/market/manager', () => ({
  marketStreamManager: {
    subscribe: vi.fn(),
    removeSocket: vi.fn(),
  },
}))

import { IndicatorMonitorRuntime } from './indicator-monitor-runtime'

function buildMonitorQuery(rows: unknown[] = []) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
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
    dbSelectMock.mockImplementation(() => buildMonitorQuery())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['collaborator-user', undefined])(
    'uses the saved OAuth owner %s for history and live data, requiring an owner',
    async (connectionOwnerUserId) => {
      dbSelectMock.mockImplementation(() =>
        buildMonitorQuery([
          {
            webhook: {
              id: 'monitor-1',
              path: 'monitor-1',
              workflowId: 'workflow-1',
              providerConfig: {
                triggerId: 'indicator_trigger',
                version: 1,
                monitor: {
                  triggerBlockId: 'trigger-1',
                  providerId: 'robinhood',
                  interval: '1m',
                  indicatorId: 'rsi',
                  listing: {
                    listing_id: 'AAPL',
                    listing_type: 'default',
                    base_id: '',
                    quote_id: '',
                  },
                  providerParams: { credentialId: 'collaborator-account' },
                  connectionOwnerUserId,
                },
              },
            },
            workflow: {
              id: 'workflow-1',
              workspaceId: 'workspace-1',
              userId: 'workflow-owner',
              isDeployed: true,
            },
          },
        ])
      )
      const runtime = new IndicatorMonitorRuntime({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
      try {
        await runtime.start()
        if (connectionOwnerUserId) {
          expect(executeProviderRequest).toHaveBeenCalledWith(
            'robinhood',
            expect.objectContaining({
              providerParams: expect.objectContaining({ credentialId: 'collaborator-account' }),
            }),
            { userId: 'collaborator-user' }
          )
          expect(marketStreamManager.subscribe).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'collaborator-user' }),
            expect.objectContaining({ providerParams: { credentialId: 'collaborator-account' } })
          )
          expect(runtime.getHealth().stats.activeSubscriptions).toBe(1)
        } else {
          expect(executeProviderRequest).not.toHaveBeenCalled()
          expect(marketStreamManager.subscribe).not.toHaveBeenCalled()
          expect(dbUpdateSetMock).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }))
        }
      } finally {
        await runtime.stop()
      }
    }
  )

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
      90
    )
    expect(runtime.getHealth().status).toBe('running')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(renewLockMock).toHaveBeenCalledWith(
      'indicator-monitor-runtime-lock',
      expect.any(String),
      90
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
      })
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
      expect.any(String)
    )

    const renewCallCount = renewLockMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(renewLockMock).toHaveBeenCalledTimes(renewCallCount)
  })
})
