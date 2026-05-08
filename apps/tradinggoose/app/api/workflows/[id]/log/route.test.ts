/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildTraceSpans: vi.fn(() => ({ totalDuration: 42, traceSpans: [] })),
  complete: vi.fn(() => Promise.resolve()),
  completeWithError: vi.fn(() => Promise.resolve()),
  getSession: vi.fn(),
  start: vi.fn(),
  validateWorkflowAccess: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mocks.validateWorkflowAccess,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (message: string, status: number) =>
    NextResponse.json({ error: message }, { status }),
  createSuccessResponse: (data: unknown) => NextResponse.json(data),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn(() => ({
    complete: mocks.complete,
    completeWithError: mocks.completeWithError,
    start: mocks.start,
  })),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: mocks.buildTraceSpans,
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

const postRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/workflows/workflow-1/log', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

describe('workflow log route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.start.mockResolvedValue('workflow-log-1')
    mocks.validateWorkflowAccess.mockResolvedValue({
      workflow: {
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('starts a workflow log before client-side execution', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        executionId: 'execution-1',
        phase: 'start',
        triggerType: 'manual',
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflowLogId: 'workflow-log-1',
    })
    expect(mocks.start).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      variables: {},
    })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.completeWithError).not.toHaveBeenCalled()
  })

  it('completes the pre-created workflow log without starting another row', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        executionId: 'execution-1',
        phase: 'complete',
        result: {
          metadata: { duration: 100 },
          output: { ok: true },
          success: true,
        },
        triggerType: 'chat',
        workflowLogId: 'workflow-log-1',
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflowLogId: 'workflow-log-1',
    })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      endedAt: expect.any(String),
      finalOutput: { ok: true },
      totalDurationMs: 42,
      traceSpans: [],
      workspaceId: 'workspace-1',
    })
  })

  it('rejects completion without the pre-created workflow log id', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        executionId: 'execution-1',
        phase: 'complete',
        result: { output: {}, success: true },
        triggerType: 'manual',
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Workflow log id is required',
    })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
