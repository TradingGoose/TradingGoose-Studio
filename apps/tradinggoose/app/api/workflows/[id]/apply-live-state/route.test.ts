/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow Apply Live State API Route', () => {
  const mockApplyWorkflowState = vi.fn()
  const mockGetWorkflowAccessContext = vi.fn()

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/workflows/workflow-id/apply-live-state', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockApplyWorkflowState.mockResolvedValue(undefined)
    mockGetWorkflowAccessContext.mockResolvedValue({
      isOwner: true,
      workflow: {
        id: 'workflow-id',
        workspaceId: 'workspace-id',
      },
    })

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      getWorkflowAccessContext: mockGetWorkflowAccessContext,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: mockApplyWorkflowState,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('applies workflow state to Yjs when the caller can update the workflow', async () => {
    const { POST } = await import('@/app/api/workflows/[id]/apply-live-state/route')
    const response = await POST(
      createRequest({
        workflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      }),
      { params: Promise.resolve({ id: 'workflow-id' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mockApplyWorkflowState).toHaveBeenCalledWith(
      'workflow-id',
      expect.objectContaining({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      })
    )
  })

  it('returns 403 when the caller lacks workflow write access', async () => {
    mockGetWorkflowAccessContext.mockResolvedValueOnce({
      isOwner: false,
      workspacePermission: 'read',
      workflow: {
        id: 'workflow-id',
        workspaceId: 'workspace-id',
      },
    })

    const { POST } = await import('@/app/api/workflows/[id]/apply-live-state/route')
    const response = await POST(
      createRequest({
        workflowState: {
          blocks: {},
          edges: [],
        },
      }),
      { params: Promise.resolve({ id: 'workflow-id' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockApplyWorkflowState).not.toHaveBeenCalled()
  })
})
