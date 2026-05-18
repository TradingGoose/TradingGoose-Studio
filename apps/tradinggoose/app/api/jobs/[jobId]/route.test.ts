/**
 * @vitest-environment node
 */

import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkHybridAuthMock,
  cancelPendingWorkflowExecutionMock,
  eqMock,
  andMock,
  orMock,
  limitMock,
} = vi.hoisted(() => ({
  checkHybridAuthMock: vi.fn(),
  cancelPendingWorkflowExecutionMock: vi.fn(),
  eqMock: vi.fn((field, value) => ({ field, value })),
  andMock: vi.fn((...args) => ({ args })),
  orMock: vi.fn((...args) => ({ args })),
  limitMock: vi.fn(),
}))

const queryChain = {
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
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
    executionType: 'pendingExecution.executionType',
  },
  permissions: {
    userId: 'permissions.userId',
    entityType: 'permissions.entityType',
    entityId: 'permissions.entityId',
  },
  workflowExecutionLogs: {
    executionId: 'workflowExecutionLogs.executionId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    level: 'workflowExecutionLogs.level',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
    totalDurationMs: 'workflowExecutionLogs.totalDurationMs',
    executionData: 'workflowExecutionLogs.executionData',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  or: orMock,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: {
    SESSION: 'session',
    API_KEY: 'api_key',
    INTERNAL_JWT: 'internal_jwt',
  },
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

const createWorkflowResult = (
  queuedExecution: Record<string, unknown>,
  finalOutput: Record<string, unknown> = { answer: 42 }
) => ({
  level: 'info',
  startedAt: new Date('2026-04-16T00:00:00.000Z'),
  endedAt: new Date('2026-04-16T00:00:02.000Z'),
  totalDurationMs: 1000,
  executionData: {
    finalOutput,
    traceSpans: [{ id: 'trace-1' }],
    trigger: {
      data: {
        queuedExecution,
      },
    },
  },
})

const mockCompletedWorkflowJob = (
  queuedExecution: Record<string, unknown>,
  finalOutput?: Record<string, unknown>
) =>
  limitMock
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([createWorkflowResult(queuedExecution, finalOutput)])

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryChain.from.mockReturnThis()
    queryChain.innerJoin.mockReturnThis()
    queryChain.leftJoin.mockReturnThis()
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

  it('filters active task lookup by the authenticated user', async () => {
    limitMock.mockResolvedValue([
      {
        id: 'job-1',
        status: 'processing',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        processingStartedAt: new Date('2026-04-16T00:00:01.000Z'),
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
      status: 'processing',
    })
  })

  it('returns public workflow output for completed workflow jobs', async () => {
    mockCompletedWorkflowJob({ source: 'workflow_execute_api' })

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

  it('does not treat successful workflow output with error property as failed', async () => {
    mockCompletedWorkflowJob({ source: 'workflow_execute_api' }, { error: 'user output' })

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
        output: { error: 'user output' },
      },
    })
    expect(body.error).toBeUndefined()
  })

  it('includes trace spans for internal child workflow polling only', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
      internalWorkflowExecution: {
        source: 'workflow_block',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })
    mockCompletedWorkflowJob({
      source: 'workflow_block',
      parentExecutionId: 'parent-execution-1',
      parentBlockId: 'workflow-block-1',
    })

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.output).toMatchObject({
      success: true,
      output: { answer: 42 },
      traceSpans: [{ id: 'trace-1' }],
      metadata: { duration: 1000 },
    })
    expect(body.output.logs).toBeUndefined()
    expect(body.output.executionId).toBeUndefined()
    expect(body.output.executedAt).toBeUndefined()
    expect(body.output.metadata.queuedExecution).toBeUndefined()
  })

  it('keeps unrelated internal workflow job output public', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
      internalWorkflowExecution: {
        source: 'workflow_block',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })
    mockCompletedWorkflowJob({
      source: 'workflow_block',
      parentExecutionId: 'other-execution',
      parentBlockId: 'workflow-block-1',
    })

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    const body = await response.json()
    expect(body.output.traceSpans).toBeUndefined()
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
