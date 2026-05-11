/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  validateWorkflowAccessMock,
  authenticateApiKeyFromHeaderMock,
  enqueuePendingExecutionMock,
  readWorkflowExecutionEventStateMock,
  workflowHasResponseBlockMock,
  createHttpResponseFromBlockMock,
} = vi.hoisted(() => ({
  validateWorkflowAccessMock: vi.fn(),
  authenticateApiKeyFromHeaderMock: vi.fn(),
  enqueuePendingExecutionMock: vi.fn(),
  readWorkflowExecutionEventStateMock: vi.fn(),
  workflowHasResponseBlockMock: vi.fn(),
  createHttpResponseFromBlockMock: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: validateWorkflowAccessMock,
}))

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: authenticateApiKeyFromHeaderMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: enqueuePendingExecutionMock,
  isPendingExecutionLimitError: vi.fn(() => false),
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionEventState: readWorkflowExecutionEventStateMock,
}))

vi.mock('@/lib/workflows/utils', () => ({
  workflowHasResponseBlock: workflowHasResponseBlockMock,
  createHttpResponseFromBlock: createHttpResponseFromBlockMock,
}))

vi.mock('@/lib/trigger/settings', () => ({
  TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
    statusCode = 409
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

describe('/api/workflows/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        name: 'Queued Workflow',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })
    authenticateApiKeyFromHeaderMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      keyId: 'api-key-1',
    })
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'workflow_execution_1',
      billingScopeId: 'workspace-1',
    })
    readWorkflowExecutionEventStateMock.mockResolvedValue({
      status: 'completed',
      errorMessage: null,
      events: [],
      result: {
        success: true,
        output: { ok: true },
        logs: [
          {
            blockId: 'block-1',
            blockType: 'function',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:00.000Z',
            durationMs: 0,
            success: true,
          },
        ],
        metadata: {
          duration: 10,
          workflowConnections: [{ source: 'a', target: 'b' }],
        },
      },
    })
    workflowHasResponseBlockMock.mockReturnValue(false)
    createHttpResponseFromBlockMock.mockImplementation((result) => {
      const response = result.output.response
      return new Response(JSON.stringify(response.data), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          ...response.headers,
        },
      })
    })
  })

  it('does not expose a GET execute adapter', async () => {
    const route = await import('./route')
    expect((route as Record<string, unknown>).GET).toBeUndefined()
  })

  it('executes POST input through the queue and returns the deployed result contract', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({ symbol: 'AAPL' }),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      output: { ok: true },
      metadata: { duration: 10 },
    })
    expect(body.logs).toBeUndefined()
    expect(body.metadata.workflowConnections).toBeUndefined()
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'workflow',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        source: 'workflow_execute_api',
        payload: expect.objectContaining({
          workflowId: 'workflow-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          input: { symbol: 'AAPL' },
          triggerType: 'api',
          executionTarget: 'deployed',
        }),
      })
    )
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledWith({
      pendingExecutionId: expect.stringMatching(/^workflow_execution_/),
      workflowId: 'workflow-1',
    })
  })

  it('accepts empty POST bodies for API triggers without input fields', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: { ok: true },
    })
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          input: {},
        }),
      })
    )
  })

  it('returns HTTP Response block output from the queued execution result', async () => {
    const responseResult = {
      success: true,
      output: {
        response: {
          data: { accepted: true },
          status: 201,
          headers: { 'X-Workflow-Response': 'created' },
        },
      },
      logs: [
        {
          blockId: 'response-1',
          blockType: 'response',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 0,
          success: true,
        },
      ],
      metadata: { duration: 10 },
    }
    readWorkflowExecutionEventStateMock.mockResolvedValue({
      status: 'completed',
      errorMessage: null,
      events: [],
      result: responseResult,
    })
    workflowHasResponseBlockMock.mockReturnValue(true)

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({ symbol: 'AAPL' }),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('X-Workflow-Response')).toBe('created')
    await expect(response.json()).resolves.toEqual({ accepted: true })
    expect(createHttpResponseFromBlockMock).toHaveBeenCalledWith(responseResult)
  })

  it('rejects non-API execution control fields on the deployed execute adapter', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({
          workflowTriggerType: 'chat',
        }),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Field "workflowTriggerType" is not supported by the deployed API execute endpoint',
    })
    expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
  })
})
