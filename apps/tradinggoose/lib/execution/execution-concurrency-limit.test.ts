/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isBillingEnabledForRuntimeMock = vi.fn()
const getActiveSubscriptionForReferenceMock = vi.fn()
const wakePendingExecutionDrainMock = vi.fn()

describe('withExecutionConcurrencyController', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    isBillingEnabledForRuntimeMock.mockReset()
    getActiveSubscriptionForReferenceMock.mockReset()
    wakePendingExecutionDrainMock.mockReset()

    isBillingEnabledForRuntimeMock.mockResolvedValue(true)
    getActiveSubscriptionForReferenceMock.mockResolvedValue({
      tier: {
        displayName: 'Community',
        concurrencyLimit: 5,
      },
    })

    vi.doMock('@/lib/billing/settings', () => ({
      isBillingEnabledForRuntime: (...args: any[]) => isBillingEnabledForRuntimeMock(...args),
    }))
    vi.doMock('@/lib/billing/core/subscription', () => ({
      getActiveSubscriptionForReference: (...args: any[]) =>
        getActiveSubscriptionForReferenceMock(...args),
    }))
    vi.doMock('@/lib/billing/workspace-billing', () => ({
      getBillingContextResolutionMessage: vi.fn((error: unknown) =>
        error instanceof Error ? error.message : 'Unable to determine usage limits.'
      ),
      resolveWorkspaceBillingContext: vi.fn(),
      resolveWorkflowBillingContext: vi.fn(),
      toRateLimitBillingScope: vi.fn(() => ({
        scopeType: 'user',
        scopeId: 'user-123',
        organizationId: null,
        userId: 'user-123',
      })),
    }))
    vi.doMock('@/lib/env', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/env')>()
      return {
        ...actual,
        env: {
          ...actual.env,
          REDIS_URL: '',
        },
      }
    })
    vi.doMock('@/lib/redis', () => ({
      getRedisClient: vi.fn(() => null),
    }))
    vi.doMock('@/lib/execution/pending-execution-drain-wake', () => ({
      wakePendingExecutionDrain: (...args: any[]) => wakePendingExecutionDrainMock(...args),
    }))
  })

  it('skips billing context resolution when billing is disabled', async () => {
    isBillingEnabledForRuntimeMock.mockResolvedValue(false)
    const task = vi.fn().mockResolvedValue('ok')

    const { withExecutionConcurrencyController } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyController({
      billingScopeId: 'user-123',
      billingScopeType: 'user',
      task: async () => task(),
    })

    expect(result).toBe('ok')
    expect(task).toHaveBeenCalledOnce()
    expect(getActiveSubscriptionForReferenceMock).not.toHaveBeenCalled()
  }, 10_000)

  it('resolves the billing tier from the queued user billing scope', async () => {
    const task = vi.fn().mockResolvedValue('ok')

    const { withExecutionConcurrencyController } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyController({
      billingScopeId: 'user-123',
      billingScopeType: 'user',
      task: async () => task(),
    })

    expect(result).toBe('ok')
    expect(getActiveSubscriptionForReferenceMock).toHaveBeenCalledWith({
      referenceType: 'user',
      referenceId: 'user-123',
    })
    expect(task).toHaveBeenCalledOnce()
    expect(wakePendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'user-123',
    })
  })

  it('resolves organization-member scopes from the owning organization subscription', async () => {
    const task = vi.fn().mockResolvedValue('ok')

    const { withExecutionConcurrencyController } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyController({
      billingScopeId: 'organization-1:user-123',
      billingScopeType: 'organization_member',
      task: async () => task(),
    })

    expect(result).toBe('ok')
    expect(getActiveSubscriptionForReferenceMock).toHaveBeenCalledWith({
      referenceType: 'organization',
      referenceId: 'organization-1',
    })
    expect(wakePendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'organization-1:user-123',
    })
  })

  it('temporarily releases the slot while waiting on deferred work', async () => {
    const { withExecutionConcurrencyController } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyController({
      billingScopeId: 'user-123',
      billingScopeType: 'user',
      task: async (controller) =>
        controller.runWithoutConcurrencySlot(() =>
          withExecutionConcurrencyController({
            billingScopeId: 'user-123',
            billingScopeType: 'user',
            task: async () => 'child-ok',
          })
        ),
    })

    expect(result).toBe('child-ok')
    expect(wakePendingExecutionDrainMock).toHaveBeenCalledWith({
      billingScopeId: 'user-123',
    })
  })
})
