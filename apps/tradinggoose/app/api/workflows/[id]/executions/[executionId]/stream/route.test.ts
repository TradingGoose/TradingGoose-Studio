/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkSessionOrInternalAuthMock,
  readPendingWorkflowExecutionAccessContextMock,
  readWorkflowAccessContextMock,
  openWorkflowExecutionEventStreamMock,
} = vi.hoisted(() => ({
  checkSessionOrInternalAuthMock: vi.fn(),
  readPendingWorkflowExecutionAccessContextMock: vi.fn(),
  readWorkflowAccessContextMock: vi.fn(),
  openWorkflowExecutionEventStreamMock: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: checkSessionOrInternalAuthMock,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  readPendingWorkflowExecutionAccessContext: readPendingWorkflowExecutionAccessContextMock,
}))

vi.mock('@/lib/execution/workflow-execution-stream', () => ({
  openWorkflowExecutionEventStream: openWorkflowExecutionEventStreamMock,
}))

vi.mock('@/lib/workflows/utils', () => ({
  readWorkflowAccessContext: readWorkflowAccessContextMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

import { GET } from './route'

describe('GET /api/workflows/[id]/executions/[executionId]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkSessionOrInternalAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    readPendingWorkflowExecutionAccessContextMock.mockResolvedValue({
      id: 'execution-1',
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    readWorkflowAccessContextMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      isOwner: false,
      isWorkspaceOwner: false,
      workspacePermission: 'read',
    })
    openWorkflowExecutionEventStreamMock.mockResolvedValue({
      ok: true,
      stream: new ReadableStream(),
    })
  })

  it('rejects execution streams outside the pending execution owner or workspace scope', async () => {
    readPendingWorkflowExecutionAccessContextMock.mockResolvedValue({
      id: 'execution-1',
      userId: 'other-user',
      workflowId: 'workflow-1',
      workspaceId: null,
    })
    readWorkflowAccessContextMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        workspaceId: null,
      },
      isOwner: true,
      isWorkspaceOwner: false,
      workspacePermission: null,
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/workflows/workflow-1/executions/execution-1/stream'
      ),
      {
        params: Promise.resolve({ id: 'workflow-1', executionId: 'execution-1' }),
      }
    )

    expect(response.status).toBe(403)
    expect(openWorkflowExecutionEventStreamMock).not.toHaveBeenCalled()
  })

  it('opens the stream only after pending execution scope authorization', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/workflows/workflow-1/executions/execution-1/stream?from=3'
      ),
      {
        params: Promise.resolve({ id: 'workflow-1', executionId: 'execution-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(readPendingWorkflowExecutionAccessContextMock).toHaveBeenCalledWith({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
    })
    expect(openWorkflowExecutionEventStreamMock).toHaveBeenCalledWith({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      fromEventId: 3,
    })
  })
})
