/**
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextResponse } from 'next/server'

const {
  checkHybridAuthMock,
  cancelPendingWorkflowExecutionMock,
  eqMock,
  andMock,
  limitMock,
} = vi.hoisted(() => ({
  checkHybridAuthMock: vi.fn(),
  cancelPendingWorkflowExecutionMock: vi.fn(),
  eqMock: vi.fn((field, value) => ({ field, value })),
  andMock: vi.fn((...args) => ({ args })),
  limitMock: vi.fn(),
}))

const queryChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: limitMock,
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => queryChain),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: {
    id: 'pendingExecution.id',
    userId: 'pendingExecution.userId',
    status: 'pendingExecution.status',
    errorMessage: 'pendingExecution.errorMessage',
    createdAt: 'pendingExecution.createdAt',
    processingStartedAt: 'pendingExecution.processingStartedAt',
    result: 'pendingExecution.result',
    completedAt: 'pendingExecution.completedAt',
    executionType: 'pendingExecution.executionType',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: checkHybridAuthMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  cancelPendingWorkflowExecution: cancelPendingWorkflowExecutionMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (message: string, status: number) =>
    NextResponse.json({ message }, { status }),
}))

import { DELETE, GET } from './route'

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryChain.from.mockReturnThis()
    queryChain.where.mockReturnThis()
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
  })

  it('requires authentication', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      message: 'Authentication required',
    })
  })

  it('filters task lookup by the authenticated user', async () => {
    limitMock.mockResolvedValue([
      {
        id: 'job-1',
        status: 'failed',
        errorMessage: 'Function execution failed',
        executionType: 'function',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        processingStartedAt: new Date('2026-04-16T00:00:01.000Z'),
        result: null,
        completedAt: new Date('2026-04-16T00:00:02.000Z'),
      },
    ])

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(eqMock).toHaveBeenNthCalledWith(1, 'pendingExecution.id', 'job-1')
    expect(eqMock).toHaveBeenNthCalledWith(2, 'pendingExecution.userId', 'user-1')
    expect(andMock).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      taskId: 'job-1',
      status: 'failed',
      error: 'Function execution failed',
    })
  })

  it('returns public workflow output for completed workflow jobs', async () => {
    limitMock.mockResolvedValue([
      {
        id: 'job-1',
        status: 'completed',
        errorMessage: null,
        executionType: 'workflow',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        processingStartedAt: new Date('2026-04-16T00:00:01.000Z'),
        result: {
          success: true,
          output: { answer: 42 },
          logs: [{ blockId: 'block-1' }],
          traceSpans: [{ id: 'trace-1' }],
          executionId: 'execution-1',
          executedAt: '2026-04-16T00:00:02.000Z',
          metadata: {
            duration: 1000,
            queuedExecution: { source: 'workflow_execute_api' },
          },
        },
        completedAt: new Date('2026-04-16T00:00:02.000Z'),
      },
    ])

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      taskId: 'job-1',
      status: 'completed',
      output: {
        success: true,
        output: { answer: 42 },
        metadata: { duration: 1000 },
      },
    })
    expect(body.output.logs).toBeUndefined()
    expect(body.output.traceSpans).toBeUndefined()
    expect(body.output.executionId).toBeUndefined()
    expect(body.output.executedAt).toBeUndefined()
    expect(body.output.metadata.queuedExecution).toBeUndefined()
  })
})

describe('DELETE /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    cancelPendingWorkflowExecutionMock.mockResolvedValue({ status: 'cancelling' })
  })

  it('requires authentication', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await DELETE(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      message: 'Authentication required',
    })
  })

  it('cancels workflow jobs for the authenticated user', async () => {
    const response = await DELETE(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(cancelPendingWorkflowExecutionMock).toHaveBeenCalledWith({
      pendingExecutionId: 'job-1',
      userId: 'user-1',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      taskId: 'job-1',
      status: 'cancelling',
    })
  })

  it('returns not found when the job does not belong to the user', async () => {
    cancelPendingWorkflowExecutionMock.mockResolvedValue({ status: 'not_found' })

    const response = await DELETE(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      message: 'Task not found',
    })
  })
})
