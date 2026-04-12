/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isBillingEnabledForRuntimeMock = vi.fn()
const resolveWorkspaceBillingContextMock = vi.fn()
const resolveWorkflowBillingContextMock = vi.fn()

describe('withCodeExecutionConcurrencyLimit', () => {
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
      resolveWorkspaceBillingContext: (...args: any[]) =>
        resolveWorkspaceBillingContextMock(...args),
      resolveWorkflowBillingContext: (...args: any[]) =>
        resolveWorkflowBillingContextMock(...args),
    }))
    vi.doMock('@/lib/env', () => ({
      env: {
        REDIS_URL: '',
      },
    }))
    vi.doMock('@/lib/redis', () => ({
      getRedisClient: vi.fn(() => null),
    }))
  })

  it('skips billing context resolution when billing is disabled', async () => {
    isBillingEnabledForRuntimeMock.mockResolvedValue(false)
    const task = vi.fn().mockResolvedValue('ok')

    const { withCodeExecutionConcurrencyLimit } = await import('@/lib/execution/concurrency-limit')

    const result = await withCodeExecutionConcurrencyLimit({
      userId: 'user-123',
      workspaceId: 'workspace-123',
      task,
    })

    expect(result).toBe('ok')
    expect(task).toHaveBeenCalledOnce()
    expect(resolveWorkspaceBillingContextMock).not.toHaveBeenCalled()
    expect(resolveWorkflowBillingContextMock).not.toHaveBeenCalled()
  })

  it('preserves tier-based concurrency checks when billing is enabled', async () => {
    const task = vi.fn().mockResolvedValue('ok')

    const { withCodeExecutionConcurrencyLimit } = await import('@/lib/execution/concurrency-limit')

    const result = await withCodeExecutionConcurrencyLimit({
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
})
