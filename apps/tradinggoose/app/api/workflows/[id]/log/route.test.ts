/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const where = vi.fn(() => Promise.resolve())
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))

  return {
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
    buildTraceSpans: vi.fn(() => ({ totalDuration: 42, traceSpans: [] })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getSession: vi.fn(),
    isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
    safeComplete: vi.fn(() => Promise.resolve()),
    safeCompleteWithError: vi.fn(() => Promise.resolve()),
    safeStart: vi.fn(),
    set,
    update,
    validateWorkflowAccess: vi.fn(),
    where,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    update: mocks.update,
  },
  orderHistoryTable: {
    workflowExecutionId: 'orderHistoryTable.workflowExecutionId',
    workflowId: 'orderHistoryTable.workflowId',
    workflowLogId: 'orderHistoryTable.workflowLogId',
    workspaceId: 'orderHistoryTable.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNull: mocks.isNull,
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
    safeComplete: mocks.safeComplete,
    safeCompleteWithError: mocks.safeCompleteWithError,
    safeStart: mocks.safeStart,
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
    mocks.safeStart.mockResolvedValue('workflow-log-1')
    mocks.validateWorkflowAccess.mockResolvedValue({
      workflow: {
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('links existing order history rows by workflow execution id after creating a workflow log', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        executionId: 'execution-1',
        result: {
          metadata: { duration: 100, source: 'manual' },
          output: { ok: true },
          success: true,
        },
      }),
      { params: Promise.resolve({ id: 'workflow-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflowLogId: 'workflow-log-1',
    })
    expect(mocks.safeStart).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      variables: {},
    })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything())
    expect(mocks.set).toHaveBeenCalledWith({ workflowLogId: 'workflow-log-1' })
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'workspace-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workflowId', 'workflow-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workflowExecutionId', 'execution-1')
    expect(mocks.isNull).toHaveBeenCalledWith('orderHistoryTable.workflowLogId')
    expect(mocks.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: 'orderHistoryTable.workspaceId', value: 'workspace-1' }),
          expect.objectContaining({ field: 'orderHistoryTable.workflowId', value: 'workflow-1' }),
          expect.objectContaining({
            field: 'orderHistoryTable.workflowExecutionId',
            value: 'execution-1',
          }),
          expect.objectContaining({ field: 'orderHistoryTable.workflowLogId', type: 'isNull' }),
        ]),
      })
    )
    expect(mocks.safeComplete).toHaveBeenCalled()
  })
})
