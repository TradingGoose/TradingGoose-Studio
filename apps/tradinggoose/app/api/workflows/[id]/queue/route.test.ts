/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  checkSessionOrInternalAuthMock,
  getWorkflowAccessContextMock,
  enqueuePendingExecutionMock,
} = vi.hoisted(() => ({
  checkSessionOrInternalAuthMock: vi.fn(),
  getWorkflowAccessContextMock: vi.fn(),
  enqueuePendingExecutionMock: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: checkSessionOrInternalAuthMock,
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowAccessContext: getWorkflowAccessContextMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: enqueuePendingExecutionMock,
  isPendingExecutionLimitError: vi.fn(() => false),
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

import { POST } from './route'

describe('POST /api/workflows/[id]/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkSessionOrInternalAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    getWorkflowAccessContextMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        name: 'Child Workflow',
        workspaceId: 'workspace-1',
        isDeployed: true,
      },
      isOwner: true,
      workspacePermission: null,
    })
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'pending-1',
      billingScopeId: 'scope-1',
    })
  })

  it('requires authentication', async () => {
    checkSessionOrInternalAuthMock.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await POST(new NextRequest('http://localhost/api/workflows/workflow-1/queue'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
    })
  })

  it('queues a child workflow execution for an authenticated session', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/workflows/workflow-1/queue', {
        method: 'POST',
        body: JSON.stringify({
          input: { symbol: 'AAPL' },
          executionTarget: 'live',
          triggerType: 'manual',
          workflowDepth: 2,
          parentWorkflowId: 'parent-1',
          parentExecutionId: 'execution-1',
          parentBlockId: 'block-1',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      }),
      {
        params: Promise.resolve({ id: 'workflow-1' }),
      }
    )

    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'workflow',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        source: 'workflow_block',
        payload: expect.objectContaining({
          input: { symbol: 'AAPL' },
          executionTarget: 'live',
          workflowDepth: 2,
          metadata: {
            source: 'workflow_block',
            parentWorkflowId: 'parent-1',
            parentExecutionId: 'execution-1',
            parentBlockId: 'block-1',
          },
        }),
      })
    )

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      success: true,
      taskId: 'pending-1',
      workflowName: 'Child Workflow',
      status: 'queued',
      createdAt: expect.any(String),
      links: {
        status: '/api/jobs/pending-1',
      },
    })
  })

  it('still accepts internal workflow calls authenticated with an internal JWT', async () => {
    checkSessionOrInternalAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/workflow-1/queue', {
        method: 'POST',
        body: JSON.stringify({
          input: { symbol: 'MSFT' },
          executionTarget: 'live',
          parentBlockId: 'block-1',
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer internal-token',
        },
      }),
      {
        params: Promise.resolve({ id: 'workflow-1' }),
      }
    )

    expect(response.status).toBe(202)
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        source: 'workflow_block',
      }),
    )
  })
})
