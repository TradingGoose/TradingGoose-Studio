/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const checkInternalAuthMock = vi.fn()
const checkWorkspaceAccessMock = vi.fn()
const executeFunctionRequestMock = vi.fn()
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
    checkWorkspaceAccessMock.mockResolvedValue({ hasAccess: true, canWrite: true })
    executeFunctionRequestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        success: true,
        output: {
          result: 'ok',
          stdout: 'stdout',
          executionTime: 2400,
        },
      },
    })

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkInternalAuth: checkInternalAuthMock,
    }))
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => loggerMock),
    }))
    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-1'),
    }))
    vi.doMock('@/lib/permissions/utils', () => ({
      checkWorkspaceAccess: checkWorkspaceAccessMock,
    }))
    vi.doMock('@/lib/function/execution', () => ({
      executeFunctionRequest: executeFunctionRequestMock,
    }))
    vi.doMock('@/lib/workflows/utils', () => ({
      readWorkflowById: readWorkflowByIdMock.mockResolvedValue({
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      }),
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
    expect(executeFunctionRequestMock).not.toHaveBeenCalled()
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
    expect(executeFunctionRequestMock).toHaveBeenCalledOnce()
    expect(executeFunctionRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return "ok"',
        workflowId: undefined,
        workspaceId: 'workspace-1',
        userId: 'user-1',
        requestId: 'request-1',
      })
    )

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
    expect(executeFunctionRequestMock).toHaveBeenCalledOnce()
  })

  it('executes under workflow context', async () => {
    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.output.result).toBe('ok')
    expect(checkWorkspaceAccessMock).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(executeFunctionRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return "ok"',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        requestId: 'request-1',
      })
    )
    expect(executeFunctionRequestMock).toHaveBeenCalledOnce()
  })

  it('rejects workflow requests when workspace access is denied', async () => {
    checkWorkspaceAccessMock.mockResolvedValueOnce({ hasAccess: false, canWrite: false })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Access denied')
    expect(executeFunctionRequestMock).not.toHaveBeenCalled()
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
    expect(executeFunctionRequestMock).not.toHaveBeenCalled()
  })

  it('forwards execution service failures', async () => {
    executeFunctionRequestMock.mockResolvedValueOnce({
      statusCode: 402,
      body: {
        success: false,
        error: 'Usage limit exceeded',
        output: {
          result: null,
          stdout: '',
          executionTime: 10,
        },
      },
    })

    const { POST } = await import('@/app/api/function/execute/route')
    const response = await POST(createFunctionRequest())
    const payload = await response.json()

    expect(response.status).toBe(402)
    expect(payload.success).toBe(false)
    expect(payload.error).toBe('Usage limit exceeded')
    expect(executeFunctionRequestMock).toHaveBeenCalledOnce()
  })

  it('returns runtime failures from the execution service', async () => {
    executeFunctionRequestMock.mockResolvedValueOnce({
      statusCode: 500,
      body: {
        success: false,
        output: {
          result: null,
          stdout: 'failure stdout',
          executionTime: 500,
        },
        error: 'Boom',
      },
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
