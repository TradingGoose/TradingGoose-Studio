/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkInternalAuthMock,
  getWorkflowAccessContextMock,
  enqueuePendingExecutionMock,
} = vi.hoisted(() => ({
  checkInternalAuthMock: vi.fn(),
  getWorkflowAccessContextMock: vi.fn(),
  enqueuePendingExecutionMock: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: checkInternalAuthMock,
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
    checkInternalAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
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
    checkInternalAuthMock.mockResolvedValue({
      success: false,
      error: 'Internal authentication required',
    })

    const response = await POST(new Request('http://localhost/api/workflows/workflow-1/queue'), {
      params: Promise.resolve({ id: 'workflow-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Internal authentication required',
    })
  })

  it('queues a child workflow execution', async () => {
    const response = await POST(
      new Request('http://localhost/api/workflows/workflow-1/queue', {
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
})
