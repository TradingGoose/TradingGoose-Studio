/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkHybridAuthMock,
  cancelPendingWorkflowExecutionMock,
  eqMock,
  andMock,
  orMock,
  limitMock,
  openStreamMock,
  workspaceAccessMock,
} = vi.hoisted(() => ({
  checkHybridAuthMock: vi.fn(),
  cancelPendingWorkflowExecutionMock: vi.fn(),
  eqMock: vi.fn((field, value) => ({ field, value })),
  andMock: vi.fn((...args) => ({ args })),
  orMock: vi.fn((...args) => ({ args })),
  limitMock: vi.fn(),
  openStreamMock: vi.fn(),
  workspaceAccessMock: vi.fn(),
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
    workflowId: 'pendingExecution.workflowId',
    userId: 'pendingExecution.userId',
    workspaceId: 'pendingExecution.workspaceId',
    status: 'pendingExecution.status',
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

vi.mock('@/lib/workflows/queued-execution-cancellation', () => ({
  cancelPendingWorkflowExecution: cancelPendingWorkflowExecutionMock,
}))

vi.mock('@/lib/execution/workflow-execution-stream', () => ({
  openWorkflowExecutionEventStream: openStreamMock,
}))

vi.mock('@/lib/permissions/utils', async (original) => ({
  ...(await original<typeof import('@/lib/permissions/utils')>()),
  checkWorkspaceAccess: workspaceAccessMock,
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
  SSE_HEADERS: { 'Content-Type': 'text/event-stream' },
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (message: string, status: number) =>
    NextResponse.json({ message }, { status }),
}))

import { DELETE, GET } from './route'

const jobParams = { params: Promise.resolve({ jobId: 'job-1' }) }
const getJob = (headers?: HeadersInit) =>
  GET(new NextRequest('http://localhost/api/jobs/job-1', { headers }), jobParams)
const deleteJob = () =>
  DELETE(new NextRequest('http://localhost/api/jobs/job-1', { method: 'DELETE' }), jobParams)
const getJobStream = (cursor = '0') =>
  getJob({ Accept: 'text/event-stream', 'Last-Event-ID': cursor })

const createWorkflowResult = (
  queuedExecution: Record<string, unknown>,
  finalOutput: Record<string, unknown> = { answer: 42 },
  level = 'info'
) => ({
  level,
  startedAt: new Date('2026-04-16T00:00:00.000Z'),
  endedAt: new Date('2026-04-16T00:00:02.000Z'),
  totalDurationMs: 1000,
  executionData: {
    finalOutput,
    ...(level === 'error' ? { errorMessage: finalOutput.error } : {}),
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
    workspaceAccessMock.mockResolvedValue({ hasAccess: true })
    queryChain.from.mockReturnThis()
    queryChain.innerJoin.mockReturnThis()
    queryChain.leftJoin.mockReturnThis()
    queryChain.where.mockReturnThis()
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
  })

  it('replays an authorized existing execution from its event cursor', async () => {
    limitMock.mockResolvedValueOnce([
      { id: 'job-1', workflowId: 'workflow-1', workspaceId: 'workspace-1', status: 'processing' },
    ])
    openStreamMock.mockResolvedValueOnce({
      ok: true,
      stream: new Response('data: [DONE]\n\n').body,
    })
    const response = await getJobStream('7')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(openStreamMock).toHaveBeenCalledExactlyOnceWith({
      pendingExecutionId: 'job-1',
      workflowId: 'workflow-1',
      fromEventId: 7,
      requestId: 'request-1',
    })
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.userId', 'user-1')
    expect(workspaceAccessMock).toHaveBeenCalledExactlyOnceWith('workspace-1', 'user-1')
  })

  it('refuses replay after the job owner loses workspace access', async () => {
    limitMock.mockResolvedValueOnce([
      { id: 'job-1', workflowId: 'workflow-1', workspaceId: 'workspace-1', status: 'processing' },
    ])
    workspaceAccessMock.mockResolvedValueOnce({ hasAccess: false })
    const response = await getJobStream()
    expect(response.status).toBe(404)
    expect(openStreamMock).not.toHaveBeenCalled()
  })

  it('does not expose stream events for inaccessible jobs or invalid cursors', async () => {
    limitMock.mockResolvedValue([])
    for (const cursor of ['0', '-1', 'NaN']) {
      const response = await getJobStream(cursor)
      expect(response.status).toBe(cursor === '0' ? 404 : 400)
    }
    expect(openStreamMock).not.toHaveBeenCalled()
  })

  it('rejects unscoped workspace keys before looking up jobs', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
    })
    const response = await getJob()
    expect(response.status).toBe(403)
    expect(queryChain.where).not.toHaveBeenCalled()
  })

  it('binds pending and paused job lookups to the API key workspace', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
      workspaceId: 'workspace-1',
    })
    limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const response = await getJob()
    expect(response.status).toBe(404)
    expect(eqMock).toHaveBeenCalledWith('pendingExecution.workspaceId', 'workspace-1')
    expect(eqMock).toHaveBeenCalledWith('workflowExecutionLogs.workspaceId', 'workspace-1')
  })

  it('requires authentication', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await getJob()

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

    const response = await getJob()

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

  it('returns workflow execution output for completed workflow jobs', async () => {
    mockCompletedWorkflowJob({ source: 'workflow_execute_api' })

    const response = await getJob()

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

  it('returns a paused result from an open log without exposing checkpoint internals or completion metadata', async () => {
    limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        ...createWorkflowResult({ source: 'workflow_execute_api' }),
        endedAt: null,
        executionData: {
          pause: { url: '/review', resumeEndpoint: '/api/resume/workflow-1/job-1', revision: 2 },
          encryptedEnvVars: { TOKEN: 'private' },
          checkpoint: { private: true },
          traceSpans: [{ input: 'private' }],
        },
      },
    ])

    const response = await getJob()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      status: 'paused',
      output: {
        success: true,
        status: 'paused',
        output: { url: '/review', resumeEndpoint: '/api/resume/workflow-1/job-1', revision: 2 },
      },
    })
    expect(body.metadata).not.toHaveProperty('completedAt')
    expect(JSON.stringify(body)).not.toContain('private')
    expect(body.output).not.toHaveProperty('traceSpans')
  })

  it('does not treat successful workflow output with error property as failed', async () => {
    mockCompletedWorkflowJob({ source: 'workflow_execute_api' }, { error: 'user output' })

    const response = await getJob()

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

    const response = await getJob()

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

  it('reports failed workflow jobs without dropping the terminal result', async () => {
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
    limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      createWorkflowResult(
        {
          source: 'workflow_block',
          parentExecutionId: 'parent-execution-1',
          parentBlockId: 'workflow-block-1',
        },
        { error: 'Child failed' },
        'error'
      ),
    ])

    const response = await getJob()

    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      taskId: 'job-1',
      status: 'failed',
      error: 'Child failed',
      output: {
        success: false,
        error: 'Child failed',
        traceSpans: [{ id: 'trace-1' }],
      },
    })
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

    const response = await getJob()

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
  })

  it('requires authentication', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await deleteJob()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      message: 'Authentication required',
    })
  })

  it.each(['cancelling', 'finished'])(
    'returns %s for cancellation by the authenticated user',
    async (status) => {
      cancelPendingWorkflowExecutionMock.mockResolvedValue({
        status,
        pendingExecutionId: 'job-1:resume:2',
      })
      const response = await deleteJob()

      expect(cancelPendingWorkflowExecutionMock).toHaveBeenCalledWith({
        pendingExecutionId: 'job-1',
        userId: 'user-1',
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, taskId: 'job-1', status })
    }
  )

  it('returns not found when the job does not belong to the user', async () => {
    cancelPendingWorkflowExecutionMock.mockResolvedValue({ status: 'not_found' })

    const response = await deleteJob()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      message: 'Task not found',
    })
  })
})
