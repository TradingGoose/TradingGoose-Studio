/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isBillingEnabledForRuntimeMock = vi.fn()
const resolveWorkspaceBillingContextMock = vi.fn()
const resolveWorkflowBillingContextMock = vi.fn()

describe('withExecutionConcurrencyLimit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    isBillingEnabledForRuntimeMock.mockReset()
    resolveWorkspaceBillingContextMock.mockReset()
    resolveWorkflowBillingContextMock.mockReset()

    isBillingEnabledForRuntimeMock.mockResolvedValue(true)
    resolveWorkspaceBillingContextMock.mockResolvedValue({
      scopeId: 'workspace-123',
      tier: {
        displayName: 'Community',
        concurrencyLimit: 5,
      },
    })
    resolveWorkflowBillingContextMock.mockResolvedValue({
      scopeId: 'workflow-123',
      tier: {
        displayName: 'Community',
        concurrencyLimit: 5,
      },
    })

    vi.doMock('@/lib/billing/settings', () => ({
      isBillingEnabledForRuntime: (...args: any[]) => isBillingEnabledForRuntimeMock(...args),
    }))
    vi.doMock('@/lib/billing/workspace-billing', () => ({
      getBillingContextResolutionMessage: vi.fn((error: unknown) =>
        error instanceof Error ? error.message : 'Unable to determine usage limits.'
      ),
      resolveWorkspaceBillingContext: (...args: any[]) =>
        resolveWorkspaceBillingContextMock(...args),
      resolveWorkflowBillingContext: (...args: any[]) =>
        resolveWorkflowBillingContextMock(...args),
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
  })

  it(
    'skips billing context resolution when billing is disabled',
    async () => {
      isBillingEnabledForRuntimeMock.mockResolvedValue(false)
      const task = vi.fn().mockResolvedValue('ok')

      const { withExecutionConcurrencyLimit } = await import(
        '@/lib/execution/execution-concurrency-limit'
      )

      const result = await withExecutionConcurrencyLimit({
        userId: 'user-123',
        workspaceId: 'workspace-123',
        task,
      })

      expect(result).toBe('ok')
      expect(task).toHaveBeenCalledOnce()
      expect(resolveWorkspaceBillingContextMock).not.toHaveBeenCalled()
      expect(resolveWorkflowBillingContextMock).not.toHaveBeenCalled()
    },
    10_000
  )

  it('resolves the billing tier concurrency limit when billing is enabled', async () => {
    const task = vi.fn().mockResolvedValue('ok')

    const { withExecutionConcurrencyLimit } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyLimit({
      userId: 'user-123',
      workspaceId: 'workspace-123',
      task,
    })

    expect(result).toBe('ok')
    expect(resolveWorkspaceBillingContextMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-123',
      actorUserId: 'user-123',
    })
    expect(task).toHaveBeenCalledOnce()
  })

  it('skips acquiring a second lease when the execution already owns one', async () => {
    const task = vi.fn().mockResolvedValue('ok')

    const { withExecutionConcurrencyLimit } = await import(
      '@/lib/execution/execution-concurrency-limit'
    )

    const result = await withExecutionConcurrencyLimit({
      concurrencyLeaseInherited: true,
      userId: 'user-123',
      workspaceId: 'workspace-123',
      task,
    })

    expect(result).toBe('ok')
    expect(task).toHaveBeenCalledOnce()
    expect(resolveWorkspaceBillingContextMock).not.toHaveBeenCalled()
    expect(resolveWorkflowBillingContextMock).not.toHaveBeenCalled()
  })
})
