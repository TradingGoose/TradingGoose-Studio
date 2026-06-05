/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  isBillingEnabledForRuntimeMock,
  resolveWorkspaceBillingContextMock,
  resolveWorkflowBillingContextMock,
  requireActiveSubscriptionForReferenceMock,
  MissingBillingSubscriptionErrorMock,
  isProdMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  isBillingEnabledForRuntimeMock: vi.fn(),
  resolveWorkspaceBillingContextMock: vi.fn(),
  resolveWorkflowBillingContextMock: vi.fn(),
  requireActiveSubscriptionForReferenceMock: vi.fn(),
  MissingBillingSubscriptionErrorMock: class MissingBillingSubscriptionError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'MissingBillingSubscriptionError'
    }
  },
  isProdMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  isBillingEnabledForRuntime: isBillingEnabledForRuntimeMock,
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  getBillingContextResolutionMessage: () => 'resolved billing error',
  resolveWorkflowBillingContext: resolveWorkflowBillingContextMock,
  resolveWorkspaceBillingContext: resolveWorkspaceBillingContextMock,
  toRateLimitBillingScope: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  MissingBillingSubscriptionError: MissingBillingSubscriptionErrorMock,
  requireActiveSubscriptionForReference: requireActiveSubscriptionForReferenceMock,
}))

vi.mock('@/lib/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/environment')>()
  return {
    ...actual,
    get isProd() {
      return isProdMock()
    },
  }
})

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ warn: loggerWarnMock }),
}))

describe('execution billing context resolution', () => {
  let executionConcurrencyLimit: typeof import('./execution-concurrency-limit')
  let billingSubscription: typeof import('@/lib/billing/core/subscription')

  beforeAll(async () => {
    executionConcurrencyLimit = await import('./execution-concurrency-limit')
    billingSubscription = await import('@/lib/billing/core/subscription')
  }, 30_000)

  beforeEach(() => {
    vi.clearAllMocks()
    isBillingEnabledForRuntimeMock.mockResolvedValue(true)
    isProdMock.mockReturnValue(false)
  })

  it('falls back to no billing context outside production when local tier resolution fails', async () => {
    const { resolveServerExecutionBillingContext } = executionConcurrencyLimit
    const { MissingBillingSubscriptionError } = billingSubscription

    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(
      new MissingBillingSubscriptionError('No active subscription')
    )

    await expect(
      resolveServerExecutionBillingContext({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        source: 'document_processing',
        requestId: 'request-1',
        logger: { warn: loggerWarnMock },
      })
    ).resolves.toBeNull()

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('continuing without billing limits in local development'),
      expect.objectContaining({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      })
    )
  })

  it('keeps production billing context failures blocking execution', async () => {
    const { resolveServerExecutionBillingContext } = executionConcurrencyLimit
    const { MissingBillingSubscriptionError } = billingSubscription

    isProdMock.mockReturnValue(true)
    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(
      new MissingBillingSubscriptionError('No active subscription')
    )

    await expect(
      resolveServerExecutionBillingContext({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('resolved billing error')
  })

  it('surfaces unexpected local billing context resolution failures', async () => {
    const { resolveServerExecutionBillingContext } = executionConcurrencyLimit

    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(
      new Error('database connection failed')
    )

    await expect(
      resolveServerExecutionBillingContext({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        logger: { warn: loggerWarnMock },
      })
    ).rejects.toThrow('database connection failed')

    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('does not fallback for plain local errors that only match the old subscription substring', async () => {
    const { resolveServerExecutionBillingContext } = executionConcurrencyLimit

    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(
      new Error('No active subscription query failed')
    )

    await expect(
      resolveServerExecutionBillingContext({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        logger: { warn: loggerWarnMock },
      })
    ).rejects.toThrow('No active subscription query failed')

    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('falls back to no concurrency limit outside production when local tier lookup fails', async () => {
    const { resolveServerExecutionBillingTierForScope } = executionConcurrencyLimit
    const { MissingBillingSubscriptionError } = billingSubscription

    requireActiveSubscriptionForReferenceMock.mockRejectedValueOnce(
      new MissingBillingSubscriptionError('No active subscription')
    )

    await expect(
      resolveServerExecutionBillingTierForScope({
        scopeId: 'user-1',
        scopeType: 'user',
      })
    ).resolves.toBeNull()

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('continuing without concurrency limits'),
      expect.objectContaining({
        scopeId: 'user-1',
      })
    )
  })

  it('surfaces unexpected local billing tier lookup failures', async () => {
    const { resolveServerExecutionBillingTierForScope } = executionConcurrencyLimit

    requireActiveSubscriptionForReferenceMock.mockRejectedValueOnce(
      new Error('database connection failed')
    )

    await expect(
      resolveServerExecutionBillingTierForScope({
        scopeId: 'user-1',
        scopeType: 'user',
      })
    ).rejects.toThrow('database connection failed')
  })
})
