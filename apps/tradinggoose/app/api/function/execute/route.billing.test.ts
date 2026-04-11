/**
 * Tests for function execution billing behavior
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockWorkflowQueryLimit = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()

describe('Function Execute Billing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockWorkflowQueryLimit.mockReset()
    mockWorkflowQueryLimit.mockResolvedValue([{ userId: 'test-user-id', workspaceId: null }])
    mockCheckWorkspaceAccess.mockReset()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'workspace-123', ownerId: 'workflow-owner' },
    })

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'test-user-id',
        authType: 'session',
      }),
    }))
    vi.doMock('@/lib/execution/concurrency-limit', () => ({
      getCodeExecutionConcurrencyLimitMessage: vi.fn(() => 'Concurrency limited'),
      isCodeExecutionConcurrencyBackendUnavailableError: vi.fn(() => false),
      isCodeExecutionConcurrencyLimitError: vi.fn(() => false),
      withCodeExecutionConcurrencyLimit: vi.fn(
        async ({ task }: { task: () => Promise<unknown> }) => await task()
      ),
    }))
    vi.doMock('@/lib/execution/local-saturation-limit', () => ({
      getLocalVmSaturationLimitMessage: vi.fn(() => 'Local VM saturated'),
      isLocalVmSaturationLimitError: vi.fn(() => false),
    }))
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
    }))
    vi.doMock('@/lib/permissions/utils', () => ({
      checkWorkspaceAccess: mockCheckWorkspaceAccess,
      getUserEntityPermissions: vi.fn().mockResolvedValue('admin'),
    }))
    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: mockWorkflowQueryLimit,
            })),
          })),
        })),
      },
    }))
    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-1'),
    }))
    vi.doMock('@/app/api/function/code-resolution', () => ({
      resolveCodeVariables: vi.fn((code: string) => ({
        resolvedCode: code,
        contextVariables: {},
      })),
    }))
    vi.doMock('@/app/api/function/typescript-utils', () => ({
      findFunctionPineDisallowedReason: vi.fn(async () => null),
      transpileTypeScriptCode: vi.fn(async (code: string) => code),
    }))
    vi.doMock('@/app/api/function/error-formatting', () => ({
      createUserFriendlyErrorMessage: vi.fn(
        (error: { message?: string }) => error.message ?? 'error'
      ),
      extractEnhancedError: vi.fn((error: Error) => ({
        message: error.message,
        name: error.name,
        originalError: error,
      })),
    }))
    vi.doMock('@/lib/billing/tiers', () => ({
      getTierFunctionExecutionDurationMultiplier: vi.fn(() => 0.5),
    }))
    vi.doMock('@/lib/billing/settings', () => ({
      getResolvedBillingSettings: vi.fn().mockResolvedValue({
        workflowExecutionChargeUsd: 0,
        functionExecutionChargeUsd: 0.25,
      }),
    }))
    vi.doMock('@/lib/billing', () => ({
      checkServerSideUsageLimits: vi.fn().mockResolvedValue({
        isExceeded: false,
        currentUsage: 0,
        limit: 100,
      }),
    }))
    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkspaceBillingContext: vi.fn().mockResolvedValue({
        tier: { id: 'tier_user_fixed' },
      }),
      resolveWorkflowBillingContext: vi.fn().mockResolvedValue({
        tier: { id: 'tier_org_adjustable' },
      }),
    }))
    vi.doMock('@/lib/billing/usage-accrual', () => ({
      accrueUserUsageCost: vi.fn().mockResolvedValue(true),
    }))
  })

  it('accrues personal function execution cost from flat and duration pricing', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn().mockResolvedValue({
        engine: 'local_vm',
        success: true,
        result: 'ok',
        stdout: '',
        executionTime: 2400,
        userCodeStartLine: 3,
      }),
    }))

    const req = createMockRequest('POST', {
      code: 'return "billed"',
    })

    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(accrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workflowId: undefined,
      cost: 1.45,
      reason: 'function_execution',
    })
  })

  it('blocks execution before runtime when usage limits are exceeded', async () => {
    const runtimeGate = vi.fn()
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: runtimeGate,
    }))

    const { checkServerSideUsageLimits } = await import('@/lib/billing')
    vi.mocked(checkServerSideUsageLimits).mockResolvedValueOnce({
      isExceeded: true,
      currentUsage: 125,
      limit: 100,
      message: 'Usage limit exceeded before execution.',
    })

    const req = createMockRequest('POST', {
      code: 'return "blocked"',
    })

    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)
    const payload = await response.json()

    expect(response.status).toBe(402)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Usage limit exceeded before execution.')
    expect(runtimeGate).not.toHaveBeenCalled()
    expect(accrueUserUsageCost).not.toHaveBeenCalled()
  })

  it('uses workflow billing context for workflow-scoped function execution', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn().mockResolvedValue({
        engine: 'e2b',
        success: true,
        result: 'ok',
        stdout: '',
        executionTime: 1000,
        userCodeStartLine: 3,
      }),
    }))

    const req = createMockRequest('POST', {
      code: 'return "workflow billed"',
      workflowId: 'workflow-123',
    })

    mockWorkflowQueryLimit.mockResolvedValueOnce([
      { userId: 'workflow-owner', workspaceId: 'workspace-123' },
    ])

    const { checkWorkspaceAccess } = await import('@/lib/permissions/utils')
    const { resolveWorkflowBillingContext } = await import('@/lib/billing/workspace-billing')
    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(checkWorkspaceAccess).toHaveBeenCalledWith('workspace-123', 'test-user-id')
    expect(resolveWorkflowBillingContext).toHaveBeenCalledWith({
      workflowId: 'workflow-123',
      actorUserId: 'test-user-id',
    })
    expect(accrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workflowId: 'workflow-123',
      cost: 0.75,
      reason: 'function_execution',
    })
  })

  it('allows workflow-scoped execution for a workspace owner without a permission row', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn().mockResolvedValue({
        engine: 'e2b',
        success: true,
        result: 'ok',
        stdout: '',
        executionTime: 1000,
        userCodeStartLine: 3,
      }),
    }))

    mockWorkflowQueryLimit.mockResolvedValueOnce([
      { userId: 'workflow-owner', workspaceId: 'workspace-123' },
    ])
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'workspace-123', ownerId: 'test-user-id' },
    })

    const { getUserEntityPermissions, checkWorkspaceAccess } = await import(
      '@/lib/permissions/utils'
    )
    const { resolveWorkflowBillingContext } = await import('@/lib/billing/workspace-billing')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(
      createMockRequest('POST', {
        code: 'return "owner allowed"',
        workflowId: 'workflow-123',
      })
    )

    expect(response.status).toBe(200)
    expect(checkWorkspaceAccess).toHaveBeenCalledWith('workspace-123', 'test-user-id')
    expect(getUserEntityPermissions).not.toHaveBeenCalledWith(
      'test-user-id',
      'workspace',
      'workspace-123'
    )
    expect(resolveWorkflowBillingContext).toHaveBeenCalledWith({
      workflowId: 'workflow-123',
      actorUserId: 'test-user-id',
    })
  })

  it('denies workflow-scoped execution before usage and billing logic when workflow access is missing', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn(),
    }))

    mockWorkflowQueryLimit.mockResolvedValueOnce([
      { userId: 'workflow-owner', workspaceId: 'workspace-123' },
    ])

    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'workspace-123', ownerId: 'workflow-owner' },
    })

    const req = createMockRequest('POST', {
      code: 'return "workflow blocked"',
      workflowId: 'workflow-123',
    })

    const { checkServerSideUsageLimits } = await import('@/lib/billing')
    const { resolveWorkflowBillingContext } = await import('@/lib/billing/workspace-billing')
    const { withCodeExecutionConcurrencyLimit } = await import('@/lib/execution/concurrency-limit')
    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Workflow access denied')
    expect(checkServerSideUsageLimits).not.toHaveBeenCalled()
    expect(withCodeExecutionConcurrencyLimit).not.toHaveBeenCalled()
    expect(resolveWorkflowBillingContext).not.toHaveBeenCalled()
    expect(accrueUserUsageCost).not.toHaveBeenCalled()
  })

  it('uses workspace billing context for ad-hoc workspace-scoped function execution', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn().mockResolvedValue({
        engine: 'e2b',
        success: true,
        result: 'ok',
        stdout: '',
        executionTime: 1000,
        userCodeStartLine: 3,
      }),
    }))

    const req = createMockRequest('POST', {
      code: 'return "workspace billed"',
      workspaceId: 'workspace-123',
    })

    const { checkServerSideUsageLimits } = await import('@/lib/billing')
    const { resolveWorkspaceBillingContext } = await import('@/lib/billing/workspace-billing')
    const { withCodeExecutionConcurrencyLimit } = await import('@/lib/execution/concurrency-limit')
    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(checkServerSideUsageLimits).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workspaceId: 'workspace-123',
      workflowId: undefined,
    })
    expect(withCodeExecutionConcurrencyLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'test-user-id',
        workspaceId: 'workspace-123',
        workflowId: undefined,
      })
    )
    expect(resolveWorkspaceBillingContext).toHaveBeenCalledWith({
      workspaceId: 'workspace-123',
      actorUserId: 'test-user-id',
    })
    expect(accrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workspaceId: 'workspace-123',
      workflowId: undefined,
      cost: 0.75,
      reason: 'function_execution',
    })
  })

  it('denies workspace-scoped execution before usage and billing logic when access is missing', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn(),
    }))

    const { getUserEntityPermissions } = await import('@/lib/permissions/utils')
    vi.mocked(getUserEntityPermissions).mockResolvedValueOnce(null)

    const req = createMockRequest('POST', {
      code: 'return "workspace blocked"',
      workspaceId: 'workspace-123',
    })

    const { checkServerSideUsageLimits } = await import('@/lib/billing')
    const { resolveWorkspaceBillingContext } = await import('@/lib/billing/workspace-billing')
    const { withCodeExecutionConcurrencyLimit } = await import('@/lib/execution/concurrency-limit')
    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Workspace access denied')
    expect(checkServerSideUsageLimits).not.toHaveBeenCalled()
    expect(withCodeExecutionConcurrencyLimit).not.toHaveBeenCalled()
    expect(resolveWorkspaceBillingContext).not.toHaveBeenCalled()
    expect(accrueUserUsageCost).not.toHaveBeenCalled()
  })

  it('bills failed function executions using attempted compute time', async () => {
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: vi.fn().mockResolvedValue({
        engine: 'local_vm',
        success: false,
        result: null,
        stdout: 'failure output',
        executionTime: 1500,
        userCodeStartLine: 3,
        error: 'Boom',
        rawError: new Error('Boom'),
      }),
    }))

    const req = createMockRequest('POST', {
      code: 'throw new Error("Boom")',
    })

    const { accrueUserUsageCost } = await import('@/lib/billing/usage-accrual')
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(req)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(accrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'test-user-id',
      workflowId: undefined,
      cost: 1,
      reason: 'function_execution',
    })
  })
})
