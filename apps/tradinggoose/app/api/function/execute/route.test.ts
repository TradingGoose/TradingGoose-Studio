/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const checkInternalAuthMock = vi.fn()
const checkWorkspaceAccessMock = vi.fn()
const checkServerSideUsageLimitsMock = vi.fn()
const executeFunctionWithRuntimeGateMock = vi.fn()
const listCustomIndicatorRuntimeEntriesMock = vi.fn()
const isBillingEnabledForRuntimeMock = vi.fn()
const accrueUserUsageCostMock = vi.fn()
const readWorkflowByIdMock = vi.fn()
const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

const workflowFunctionBody = (body: Record<string, unknown> = {}) => ({
  code: 'return "ok"',
  workflowId: 'workflow-1',
  ...body,
})

const createFunctionRequest = (body: Record<string, unknown> = {}) =>
  createMockRequest('POST', workflowFunctionBody(body))

describe('Function Execute API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    checkInternalAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    checkServerSideUsageLimitsMock.mockResolvedValue({
      isExceeded: false,
      currentUsage: 0,
      limit: 100,
    })
    checkWorkspaceAccessMock.mockResolvedValue({ hasAccess: true, canWrite: true })
    executeFunctionWithRuntimeGateMock.mockResolvedValue({
      engine: 'local_vm',
      success: true,
      result: 'ok',
      stdout: 'stdout',
      executionTime: 2400,
      userCodeStartLine: 3,
    })
    listCustomIndicatorRuntimeEntriesMock.mockResolvedValue([
      { id: 'indicator-1', pineCode: 'indicator("Custom Indicator")' },
    ])
    isBillingEnabledForRuntimeMock.mockResolvedValue(false)
    accrueUserUsageCostMock.mockResolvedValue(true)

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkInternalAuth: checkInternalAuthMock,
    }))
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => loggerMock),
    }))
    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-1'),
    }))
    vi.doMock('@/lib/billing', () => ({
      checkServerSideUsageLimits: checkServerSideUsageLimitsMock,
    }))
    vi.doMock('@/lib/billing/settings', () => ({
      getResolvedBillingSettings: vi.fn().mockResolvedValue({
        functionExecutionChargeUsd: 0.25,
      }),
      isBillingEnabledForRuntime: isBillingEnabledForRuntimeMock,
    }))
    vi.doMock('@/lib/billing/tiers', () => ({
      getTierFunctionExecutionMultiplier: vi.fn(() => 0.5),
    }))
    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkflowBillingContext: vi.fn().mockResolvedValue({
        tier: { id: 'tier-1' },
      }),
      resolveWorkspaceBillingContext: vi.fn().mockResolvedValue({
        tier: { id: 'tier-1' },
      }),
    }))
    vi.doMock('@/lib/billing/usage-accrual', () => ({
      accrueUserUsageCost: accrueUserUsageCostMock,
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
        (error: { message?: string }) => error.message ?? 'Function execution failed'
      ),
      extractEnhancedError: vi.fn((error: Error) => ({
        message: error.message,
        name: error.name,
        stack: error.stack,
      })),
    }))
    vi.doMock('@/app/api/function/e2b-execution', () => ({
      executeFunctionWithRuntimeGate: executeFunctionWithRuntimeGateMock,
    }))
    vi.doMock('@/lib/indicators/custom/operations', () => ({
      listCustomIndicatorRuntimeEntries: listCustomIndicatorRuntimeEntriesMock,
    }))
    vi.doMock('@/lib/permissions/utils', () => ({
      checkWorkspaceAccess: checkWorkspaceAccessMock,
    }))
    vi.doMock('@/lib/workflows/utils', () => ({
      readWorkflowById: readWorkflowByIdMock.mockResolvedValue({
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      }),
    }))
    vi.doMock('@/lib/execution/local-saturation-limit', () => ({
      getLocalVmSaturationLimitMessage: vi.fn(() => 'Local VM saturated'),
      isLocalVmSaturationLimitError: vi.fn((error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            (error as { code?: string }).code === 'LOCAL_VM_SATURATION_LIMIT'
        )
      ),
    }))
  })

  it('rejects requests without internal auth', async () => {
    checkInternalAuthMock.mockResolvedValueOnce({ success: false })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Unauthorized')
  })

  it('accepts exactly one execution scope', async () => {
    const { POST } = await import('@/app/api/function/execute/route')
    const workspaceResponse = await POST(
      createMockRequest('POST', {
        code: 'return "ok"',
        workspaceId: 'workspace-1',
      })
    )

    expect(workspaceResponse.status).toBe(200)
    expect(readWorkflowByIdMock).not.toHaveBeenCalled()

    const mixedScopeResponse = await POST(
      createMockRequest('POST', {
        code: 'return "ok"',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      })
    )
    const mixedScopePayload = await mixedScopeResponse.json()

    expect(mixedScopeResponse.status).toBe(400)
    expect(mixedScopePayload.error).toBe(
      'Function execution accepts either workflow or workspace context, not both'
    )
    expect(executeFunctionWithRuntimeGateMock).toHaveBeenCalledOnce()
  })

  it('executes under workflow context', async () => {
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.output.result).toBe('ok')
    expect(checkServerSideUsageLimitsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    expect(checkWorkspaceAccessMock).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(listCustomIndicatorRuntimeEntriesMock).toHaveBeenCalledWith('workspace-1')
    expect(executeFunctionWithRuntimeGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indicatorRuntimeManifest: expect.objectContaining({
          indicators: expect.arrayContaining([expect.objectContaining({ id: 'indicator-1' })]),
        }),
      })
    )
    expect(executeFunctionWithRuntimeGateMock).toHaveBeenCalledOnce()
  })

  it('rejects workflow requests when workspace access is denied', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({ hasAccess: false, canWrite: false })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Access denied')
    expect(executeFunctionWithRuntimeGateMock).not.toHaveBeenCalled()
  })

  it('rejects workspace-scoped function execution for read-only workspace members', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({ hasAccess: true, canWrite: false })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(
      createMockRequest('POST', {
        code: 'return "ok"',
        workspaceId: 'workspace-1',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Access denied')
    expect(executeFunctionWithRuntimeGateMock).not.toHaveBeenCalled()
  })

  it('blocks before runtime when workflow usage is exceeded', async () => {
    checkServerSideUsageLimitsMock.mockResolvedValueOnce({
      isExceeded: true,
      currentUsage: 101,
      limit: 100,
      message: 'Usage limit exceeded',
    })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(402)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Usage limit exceeded')
    expect(executeFunctionWithRuntimeGateMock).not.toHaveBeenCalled()
  })

  it('accrues workflow-scoped function execution cost after runtime finishes', async () => {
    isBillingEnabledForRuntimeMock.mockResolvedValueOnce(true)

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())

    expect(response.status).toBe(200)
    expect(accrueUserUsageCostMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      cost: 0.3,
      reason: 'function_execution',
    })
  })

  it('keeps runtime success when post-run billing accrual fails', async () => {
    isBillingEnabledForRuntimeMock.mockResolvedValueOnce(true)
    accrueUserUsageCostMock.mockRejectedValueOnce(new Error('billing unavailable'))

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.output.result).toBe('ok')
  })

  it('returns runtime failures without retrying through pending execution', async () => {
    executeFunctionWithRuntimeGateMock.mockResolvedValueOnce({
      engine: 'local_vm',
      success: false,
      result: null,
      stdout: 'failure stdout',
      executionTime: 500,
      error: 'Boom',
      userCodeStartLine: 3,
    })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Boom')
    expect(payload.output.stdout).toBe('failure stdout')
  })
})
