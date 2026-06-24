import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow State API Route', () => {
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
    variables: {},
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

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
          name: 'Workflow',
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

  it('rejects workflow saves that omit variables', async () => {
    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const bodyWithoutVariables = { ...validStateBody } as Record<string, unknown>
    delete bodyWithoutVariables.variables
    const response = await PUT(createRequest(bodyWithoutVariables), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(400)
    expect(applyWorkflowStateMock).not.toHaveBeenCalled()
  })

  it('replaces variables when the request body includes them', async () => {
    const { PUT } = await import('@/app/api/workflows/[id]/state/route')
    const variables = {
      'request-var': {
        id: 'request-var',
        workflowId: 'workflow-id',
        name: 'requestVar',
        type: 'plain',
        value: 'request value',
      },
    }
    const response = await PUT(
      createRequest({
        ...validStateBody,
        variables,
      }),
      {
        params: Promise.resolve({ id: 'workflow-id' }),
      }
    )

    expect(response.status).toBe(200)
    expect(applyWorkflowStateMock).toHaveBeenCalledWith(
      'workflow-id',
      expect.any(Object),
      variables,
      'Workflow'
    )
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
