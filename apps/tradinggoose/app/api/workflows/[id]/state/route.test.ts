import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow State API Route', () => {
  let loadWorkflowStateFromYjsMock: ReturnType<typeof vi.fn>
  let applyWorkflowStateMock: ReturnType<typeof vi.fn>

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/workflows/workflow-id/state', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })

  const validStateBody = {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    loadWorkflowStateFromYjsMock = vi.fn().mockResolvedValue(null)
    applyWorkflowStateMock = vi.fn().mockResolvedValue(undefined)

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

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      validateWorkflowPermissions: vi.fn().mockResolvedValue({
        error: null,
        session: { user: { id: 'user-id' } },
        workflow: {
          id: 'workflow-id',
          workspaceId: 'workspace-id',
          variables: {
            'db-var': {
              id: 'db-var',
              workflowId: 'workflow-id',
              name: 'dbVar',
              type: 'plain',
              value: 'db value',
            },
          },
        },
      }),
    }))

    vi.doMock('@/lib/workflows/validation', () => ({
      sanitizeAgentToolsInBlocks: vi.fn((blocks) => ({
        blocks,
        warnings: [],
      })),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      ensureUniqueBlockIds: vi.fn(async (_workflowId: string, state: any) => state),
      ensureUniqueEdgeIds: vi.fn(async (_workflowId: string, state: any) => state),
      loadWorkflowStateFromYjs: loadWorkflowStateFromYjsMock,
      toISOStringOrUndefined: vi.fn((value: string | number | Date | null | undefined) =>
        value == null ? undefined : new Date(value).toISOString()
      ),
    }))

    vi.doMock('@/lib/workflows/custom-tools-persistence', () => ({
      extractAndPersistCustomTools: vi.fn().mockResolvedValue({
        saved: 0,
        errors: [],
      }),
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: applyWorkflowStateMock,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to authoritative Yjs variables when the request body omits them', async () => {
    loadWorkflowStateFromYjsMock.mockResolvedValueOnce({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {
        'live-var': {
          id: 'live-var',
          workflowId: 'workflow-id',
          name: 'liveVar',
          type: 'plain',
          value: 'live value',
        },
      },
      lastSaved: Date.now(),
    })

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(200)
    expect(applyWorkflowStateMock).toHaveBeenCalledWith(
      'workflow-id',
      expect.any(Object),
      {
        'live-var': expect.objectContaining({
          name: 'liveVar',
          value: 'live value',
        }),
      },
      undefined
    )
  })

  it('rejects saves without request or Yjs variables', async () => {
    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(409)
    expect(applyWorkflowStateMock).not.toHaveBeenCalled()
  })

  it('rejects saves when authoritative Yjs variable lookup fails', async () => {
    loadWorkflowStateFromYjsMock.mockRejectedValueOnce(new Error('socket bridge unavailable'))

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(createRequest(validStateBody), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(409)
    expect(applyWorkflowStateMock).not.toHaveBeenCalled()
  })

  it('returns an error when workflow state apply fails', async () => {
    applyWorkflowStateMock.mockRejectedValueOnce(new Error('validation failed'))

    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const response = await PUT(
      createRequest({
        ...validStateBody,
        variables: {},
      }),
      {
        params: Promise.resolve({ id: 'workflow-id' }),
      }
    )

    expect(response.status).toBe(500)
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()
  })
})
