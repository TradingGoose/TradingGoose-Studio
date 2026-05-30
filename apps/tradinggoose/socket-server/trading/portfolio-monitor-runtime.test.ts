/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
  getRedisClient: vi.fn(() => ({})),
  getRedisStorageMode: vi.fn(() => 'redis'),
  dbSelect: vi.fn(),
  getApiKeyOwnerUserId: vi.fn(),
  enqueuePendingExecution: vi.fn(),
  isPendingExecutionLimitError: vi.fn(() => false),
  evaluatePortfolioFireCondition: vi.fn(() => true),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.dbSelect,
  },
  webhook: {
    id: 'webhook.id',
    provider: 'webhook.provider',
    providerConfig: 'webhook.providerConfig',
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
}))

vi.mock('@/lib/api-key/service', () => ({
  getApiKeyOwnerUserId: (...args: unknown[]) => mocks.getApiKeyOwnerUserId(...args),
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  ExecutionGateError: class ExecutionGateError extends Error {},
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: (...args: unknown[]) => mocks.enqueuePendingExecution(...args),
  isPendingExecutionLimitError: () => mocks.isPendingExecutionLimitError(),
}))

vi.mock('@/lib/monitors/portfolio-conditions', () => ({
  evaluatePortfolioFireCondition: () => mocks.evaluatePortfolioFireCondition(),
}))

vi.mock('@/lib/monitors/portfolio-config', () => ({
  PortfolioMonitorProviderConfigSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}))

vi.mock('@/lib/monitors/sources', () => ({
  PORTFOLIO_MONITOR_PROVIDER: 'portfolio_trigger',
}))

vi.mock('@/lib/redis', () => ({
  acquireLock: (...args: unknown[]) => mocks.acquireLock(...args),
  renewLock: (...args: unknown[]) => mocks.renewLock(...args),
  releaseLock: (...args: unknown[]) => mocks.releaseLock(...args),
  getRedisClient: () => mocks.getRedisClient(),
  getRedisStorageMode: () => mocks.getRedisStorageMode(),
}))

vi.mock('@/socket-server/trading/portfolio-manager', () => ({
  tradingPortfolioStreamManager: {
    subscribeData: vi.fn(),
  },
}))

import { PortfolioMonitorRuntime } from './portfolio-monitor-runtime'

type PortfolioMonitorRuntimeInternals = {
  subscriptions: Map<
    string,
    {
      config: ReturnType<typeof buildMonitorConfig>
      unsubscribe: () => void
    }
  >
  updateRuntimeState: (monitorId: string, runtimeState: unknown) => Promise<void> | void
  handlePortfolioData: (
    monitorId: string,
    payload: ReturnType<typeof buildPortfolioPayload>
  ) => Promise<void>
}

function buildEmptyMonitorQuery() {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  }
}

function buildMonitorConfig() {
  return {
    id: 'monitor-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    connectionOwnerUserId: 'connection-owner-1',
    pinnedApiKeyId: 'api-key-1',
    blockId: 'block-1',
    providerId: 'alpaca',
    serviceId: 'alpaca-live',
    credentialId: 'credential-1',
    accountId: 'account-1',
    condition: { combinator: 'and', rules: [] },
    fireMode: 'edge',
    cooldownSeconds: 0,
    pollIntervalSeconds: 30,
    runtimeState: {
      wasTrue: false,
    },
    signature: 'signature-1',
  }
}

function buildPortfolioPayload() {
  return {
    provider: 'alpaca',
    workspaceId: 'workspace-1',
    serviceId: 'alpaca-live',
    channel: 'account-snapshot',
    portfolioIdentity: {
      providerId: 'alpaca',
      credentialId: 'credential-1',
      serviceId: 'alpaca-live',
      accountId: 'account-1',
    },
    portfolioDetail: {
      providerId: 'alpaca',
      credentialId: 'credential-1',
      serviceId: 'alpaca-live',
      accountId: 'account-1',
    },
    receivedAt: '2026-05-28T00:00:00.000Z',
  }
}

function attachRuntimeSubscription(
  runtime: PortfolioMonitorRuntimeInternals,
  config: ReturnType<typeof buildMonitorConfig>
) {
  const updateRuntimeState = vi.fn()
  runtime.subscriptions.set('monitor-1', { config, unsubscribe: vi.fn() })
  runtime.updateRuntimeState = updateRuntimeState
  Object.assign(runtime, { getCurrentProviderConfig: vi.fn().mockResolvedValue({}) })
  return updateRuntimeState
}

describe('PortfolioMonitorRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.acquireLock.mockResolvedValue(true)
    mocks.renewLock.mockResolvedValue(true)
    mocks.releaseLock.mockResolvedValue(true)
    mocks.getRedisClient.mockReturnValue({})
    mocks.getRedisStorageMode.mockReturnValue('redis')
    mocks.dbSelect.mockImplementation(() => buildEmptyMonitorQuery())
    mocks.getApiKeyOwnerUserId.mockResolvedValue('actor-1')
    mocks.enqueuePendingExecution.mockResolvedValue({
      pendingExecutionId: 'pending-monitor-1',
      billingScopeId: 'user-1',
      inserted: true,
    })
    mocks.isPendingExecutionLimitError.mockReturnValue(false)
    mocks.evaluatePortfolioFireCondition.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires and renews the portfolio runtime lock', async () => {
    const runtime = new PortfolioMonitorRuntime({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })

    await runtime.start()

    expect(mocks.acquireLock).toHaveBeenCalledWith(
      'portfolio-monitor-runtime-lock',
      expect.any(String),
      90
    )
    expect(runtime.getHealth().status).toBe('running')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.renewLock).toHaveBeenCalledWith(
      'portfolio-monitor-runtime-lock',
      expect.any(String),
      90
    )

    await runtime.stop()
    expect(mocks.releaseLock).toHaveBeenCalledWith(
      'portfolio-monitor-runtime-lock',
      expect.any(String)
    )
  })

  it('does not persist edge state when enqueue is rejected by backpressure', async () => {
    const runtime = new PortfolioMonitorRuntime() as unknown as PortfolioMonitorRuntimeInternals
    const config = buildMonitorConfig()
    const updateRuntimeState = attachRuntimeSubscription(runtime, config)
    const limitError = {
      details: {
        pendingCount: 100,
        maxPendingCount: 100,
      },
    }

    mocks.enqueuePendingExecution.mockRejectedValue(limitError)
    mocks.isPendingExecutionLimitError.mockReturnValue(true)

    await runtime.handlePortfolioData('monitor-1', buildPortfolioPayload())

    expect(mocks.enqueuePendingExecution).toHaveBeenCalledTimes(1)
    expect(updateRuntimeState).not.toHaveBeenCalled()
    expect(config.runtimeState).toEqual({ wasTrue: false })
  })

  it('does not persist edge state when enqueue is deduped by ordering key', async () => {
    const runtime = new PortfolioMonitorRuntime() as unknown as PortfolioMonitorRuntimeInternals
    const config = buildMonitorConfig()
    const updateRuntimeState = attachRuntimeSubscription(runtime, config)

    mocks.enqueuePendingExecution.mockResolvedValue({
      pendingExecutionId: 'pending-monitor-1',
      billingScopeId: 'user-1',
      inserted: false,
    })

    await runtime.handlePortfolioData('monitor-1', buildPortfolioPayload())

    expect(mocks.enqueuePendingExecution).toHaveBeenCalledTimes(1)
    expect(updateRuntimeState).not.toHaveBeenCalled()
    expect(config.runtimeState).toEqual({ wasTrue: false })
  })
})
