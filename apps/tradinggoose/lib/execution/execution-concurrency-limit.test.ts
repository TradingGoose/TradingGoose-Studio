/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  isBillingEnabledForRuntimeMock,
  resolveWorkspaceBillingContextMock,
  resolveWorkflowBillingContextMock,
  getActiveSubscriptionForReferenceMock,
  isProdMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  isBillingEnabledForRuntimeMock: vi.fn(),
  resolveWorkspaceBillingContextMock: vi.fn(),
  resolveWorkflowBillingContextMock: vi.fn(),
  getActiveSubscriptionForReferenceMock: vi.fn(),
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
  getActiveSubscriptionForReference: getActiveSubscriptionForReferenceMock,
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

describe('execution billing context resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isBillingEnabledForRuntimeMock.mockResolvedValue(true)
    isProdMock.mockReturnValue(false)
  })

  it('falls back to no billing context outside production when local tier resolution fails', async () => {
    const { resolveServerExecutionBillingContext } = await import(
      './execution-concurrency-limit'
    )

    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(new Error('No active subscription'))

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
    const { resolveServerExecutionBillingContext } = await import(
      './execution-concurrency-limit'
    )

    isProdMock.mockReturnValue(true)
    resolveWorkspaceBillingContextMock.mockRejectedValueOnce(new Error('No active subscription'))

    await expect(
      resolveServerExecutionBillingContext({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('resolved billing error')
  })

  it('falls back to no concurrency limit outside production when local tier lookup fails', async () => {
    const { resolveServerExecutionBillingTierForScope } = await import(
      './execution-concurrency-limit'
    )

    getActiveSubscriptionForReferenceMock.mockRejectedValueOnce(
      new Error('No active subscription')
    )

    await expect(
      resolveServerExecutionBillingTierForScope({
        scopeId: 'user-1',
        scopeType: 'user',
      })
    ).resolves.toBeNull()
  })
})
