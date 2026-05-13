/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  validateWorkflowAccessMock,
  enqueuePendingExecutionMock,
  enforceServerExecutionRateLimitMock,
  openWorkflowExecutionEventStreamMock,
  loadDeployedWorkflowStateMock,
  uploadExecutionFileMock,
  readWorkflowExecutionEventStateMock,
  workflowHasResponseBlockMock,
  createHttpResponseFromBlockMock,
} = vi.hoisted(() => ({
  validateWorkflowAccessMock: vi.fn(),
  enqueuePendingExecutionMock: vi.fn(),
  enforceServerExecutionRateLimitMock: vi.fn(),
  openWorkflowExecutionEventStreamMock: vi.fn(),
  loadDeployedWorkflowStateMock: vi.fn(),
  uploadExecutionFileMock: vi.fn(),
  readWorkflowExecutionEventStateMock: vi.fn(),
  workflowHasResponseBlockMock: vi.fn(),
  createHttpResponseFromBlockMock: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: validateWorkflowAccessMock,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: {
    API_KEY: 'api_key',
  },
}))

vi.mock('@/lib/execution/execution-concurrency-limit', () => ({
  ExecutionGateError: class ExecutionGateError extends Error {
    statusCode = 402
  },
  enforceServerExecutionRateLimit: enforceServerExecutionRateLimitMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: enqueuePendingExecutionMock,
  isPendingExecutionLimitError: vi.fn(() => false),
}))

vi.mock('@/lib/execution/workflow-execution-stream', () => ({
  openWorkflowExecutionEventStream: openWorkflowExecutionEventStreamMock,
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionEventState: readWorkflowExecutionEventStateMock,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: uploadExecutionFileMock,
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadDeployedWorkflowState: loadDeployedWorkflowStateMock,
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
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/lib/utils', () => ({
  encodeSSE: vi.fn((payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`),
  generateRequestId: vi.fn(() => 'request-1'),
  SSE_HEADERS: { 'Content-Type': 'text/event-stream' },
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
      apiKeyAuth: {
        success: true,
        userId: 'user-1',
        keyId: 'api-key-1',
      },
    })
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'workflow_execution_1',
      billingScopeId: 'workspace-1',
    })
    enforceServerExecutionRateLimitMock.mockResolvedValue(undefined)
    openWorkflowExecutionEventStreamMock.mockResolvedValue({
      ok: true,
      stream: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    })
    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: false,
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
        traceSpans: [{ id: 'span-1' }],
        executionId: 'workflow_execution_1',
        executedAt: '2026-01-01T00:00:00.000Z',
        metadata: {
          duration: 10,
          workflowConnections: [{ source: 'a', target: 'b' }],
          queuedExecution: { source: 'workflow_execute_api' },
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
    const rawFile = {
      type: 'file',
      data: 'data:text/plain;base64,SGVsbG8=',
      name: 'hello.txt',
      mime: 'text/plain',
    }
    const executionFile = {
      id: 'file-1',
      name: 'hello.txt',
      url: 'https://files.example.com/hello.txt',
      key: 'execution/hello.txt',
      size: 5,
      type: 'text/plain',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-08T00:00:00.000Z',
    }
    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {
        trigger: {
          type: 'api_trigger',
          subBlocks: {
            inputFormat: {
              value: [{ name: 'documents', type: 'files' }],
            },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: false,
    })
    uploadExecutionFileMock.mockResolvedValue(executionFile)

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({ symbol: 'AAPL', documents: [rawFile] }),
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
    expect(body.traceSpans).toBeUndefined()
    expect(body.executionId).toBeUndefined()
    expect(body.executedAt).toBeUndefined()
    expect(body.metadata.workflowConnections).toBeUndefined()
    expect(body.metadata.queuedExecution).toBeUndefined()
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
          input: { symbol: 'AAPL', documents: [executionFile] },
          triggerType: 'api',
          executionTarget: 'deployed',
          stream: false,
        }),
      })
    )
    expect(enforceServerExecutionRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        authType: 'api_key',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        triggerType: 'api',
      })
    )
    expect(uploadExecutionFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: expect.stringMatching(/^workflow_execution_/),
      }),
      expect.any(Buffer),
      'hello.txt',
      'text/plain'
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

  it('returns 400 when API trigger file processing fails', async () => {
    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {
        trigger: {
          type: 'api_trigger',
          subBlocks: {
            inputFormat: {
              value: [{ name: 'documents', type: 'files' }],
            },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: false,
    })
    uploadExecutionFileMock.mockRejectedValueOnce(new Error('Upload failed'))

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({
          documents: [
            {
              type: 'file',
              data: 'data:text/plain;base64,SGVsbG8=',
              name: 'hello.txt',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Failed to upload file: hello.txt',
    })
    expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
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

  it('returns a queued handle when API execution remains running after the HTTP wait window', async () => {
    vi.useFakeTimers()
    readWorkflowExecutionEventStateMock.mockResolvedValue({
      status: 'processing',
      errorMessage: null,
      events: [],
      result: null,
    })

    try {
      const { POST } = await import('./route')
      const responsePromise = POST(
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

      await vi.advanceTimersByTimeAsync(26_000)
      const response = await responsePromise

      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        status: 'queued',
        taskId: expect.stringMatching(/^workflow_execution_/),
        links: {
          status: expect.stringMatching(/^\/api\/jobs\/workflow_execution_/),
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('streams queued API executions through the public execute endpoint', async () => {
    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {
        'agent-1': { id: 'agent-1', type: 'agent', name: 'Agent 1' },
      },
      edges: [],
      loops: {},
      parallels: {},
      isFromNormalizedTables: false,
    })
    openWorkflowExecutionEventStreamMock.mockImplementationOnce(async (params: any) => {
      const encoder = new TextEncoder()
      const result = {
        success: true,
        output: { answer: 'done' },
        logs: [
          {
            blockId: 'agent-1',
            blockType: 'agent',
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:00.000Z',
            durationMs: 0,
            success: true,
            output: { content: 'hello world' },
          },
        ],
        traceSpans: [{ id: 'span-1' }],
        executionId: 'workflow_execution_1',
        executedAt: '2026-01-01T00:00:00.000Z',
        metadata: {
          duration: 10,
          workflowConnections: [{ source: 'agent-1', target: 'done' }],
        },
      }
      const entries = [
        {
          eventId: 1,
          event: {
            type: 'stream:chunk',
            executionId: 'workflow_execution_1',
            workflowId: 'workflow-1',
            timestamp: '2026-01-01T00:00:00.000Z',
            data: { blockId: 'agent-1', chunk: 'hello' },
          },
        },
        {
          eventId: 2,
          event: {
            type: 'execution:completed',
            executionId: 'workflow_execution_1',
            workflowId: 'workflow-1',
            timestamp: '2026-01-01T00:00:01.000Z',
            data: { result },
          },
        },
      ]

      return {
        ok: true,
        stream: new ReadableStream({
          start(controller) {
            for (const entry of entries) {
              const chunks = params.formatEvent(entry)
              for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
                if (chunk)
                  controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
              }
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }),
      }
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('https://example.com/api/workflows/workflow-1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'key-1',
        },
        body: JSON.stringify({
          input: { symbol: 'AAPL' },
          stream: true,
          selectedOutputs: ['Agent 1.content'],
        }),
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('data: {"blockId":"agent-1","chunk":"hello"}\n\n')
    expect(body).toContain(
      'data: {"event":"final","data":{"success":true,"output":{"answer":"done"},"metadata":{"duration":10}}}\n\n'
    )
    expect(body).not.toContain('traceSpans')
    expect(body).not.toContain('workflowConnections')
    expect(body).not.toContain('workflow_execution_1')
    expect(openWorkflowExecutionEventStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingExecutionId: expect.stringMatching(/^workflow_execution_/),
        workflowId: 'workflow-1',
      })
    )
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          input: { symbol: 'AAPL' },
          selectedOutputs: ['agent-1_content'],
          stream: true,
        }),
      })
    )
  })
})
