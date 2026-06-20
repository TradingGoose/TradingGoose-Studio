/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow API Route', () => {
  const insertValuesMock = vi.fn()
  const deleteWhereMock = vi.fn()
  const saveWorkflowToNormalizedTablesMock = vi.fn()
  const applyWorkflowStateMock = vi.fn()
  const randomUUIDMock = vi.fn()
  const callOrder: string[] = []

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/workflows', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    callOrder.length = 0

    insertValuesMock.mockResolvedValue(undefined)
    deleteWhereMock.mockResolvedValue(undefined)
    saveWorkflowToNormalizedTablesMock.mockImplementation(async (_workflowId, state) => {
      callOrder.push('save')
      return { success: true, normalizedState: state }
    })
    applyWorkflowStateMock.mockImplementation(async () => {
      callOrder.push('apply')
    })
    randomUUIDMock.mockReset()
    randomUUIDMock.mockReturnValueOnce('workflow-123').mockReturnValueOnce('variable-123')
    vi.stubGlobal('crypto', {
      randomUUID: randomUUIDMock,
    })

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        insert: vi.fn().mockReturnValue({
          values: insertValuesMock,
        }),
        delete: vi.fn().mockReturnValue({
          where: deleteWhereMock,
        }),
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      workflow: {
        id: 'workflow.id',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value })),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
      }),
    }))

    vi.doMock('@/lib/colors', () => ({
      getStableVibrantColor: vi.fn(() => '#123456'),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/permissions/utils', () => ({
      checkWorkspaceAccess: vi.fn().mockResolvedValue({
        exists: true,
        hasAccess: true,
        canWrite: true,
      }),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      ensureUniqueBlockIds: vi.fn(async (_workflowId: string, state: any) => state),
      ensureUniqueEdgeIds: vi.fn(async (_workflowId: string, state: any) => state),
      remapVariableIds: vi.fn((variables: Record<string, any>, workflowId: string) =>
        Object.fromEntries(
          Object.entries(variables).map(([key, variable]) => [
            key,
            {
              ...variable,
              id: crypto.randomUUID(),
              workflowId,
            },
          ])
        )
      ),
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: applyWorkflowStateMock,
    }))

    vi.doMock('@/lib/yjs/workflow-session', () => ({
      createWorkflowSnapshot: vi.fn((snapshot) => snapshot),
    }))

    vi.doMock('@/lib/telemetry/tracer', () => ({
      trackPlatformEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('seeds Yjs before materializing initial workflow state', async () => {
    const initialWorkflowState = {
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
      variables: {
        'var-1': {
          id: 'var-1',
          workflowId: 'template-workflow',
          name: 'apiKey',
          type: 'plain',
          value: 'secret',
        },
      },
    }

    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(
      createRequest({
        name: 'Workflow Copy',
        description: 'Created from seed',
        workspaceId: 'workspace-1',
        initialWorkflowState,
      })
    )

    expect(response.status).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()
    expect(callOrder).toEqual(['apply', 'save'])

    const insertedWorkflow = insertValuesMock.mock.calls[0][0]
    const canonicalState = saveWorkflowToNormalizedTablesMock.mock.calls[0][1]

    const insertedVariableValues = Object.values(insertedWorkflow.variables as Record<string, any>)
    expect(insertedVariableValues).toHaveLength(1)
    expect(insertedVariableValues[0]).toEqual({
      id: 'variable-123',
      workflowId: insertedWorkflow.id,
      name: 'apiKey',
      type: 'plain',
      value: 'secret',
    })
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledWith(
      insertedWorkflow.id,
      expect.objectContaining({
        blocks: initialWorkflowState.blocks,
        edges: initialWorkflowState.edges,
        loops: initialWorkflowState.loops,
        parallels: initialWorkflowState.parallels,
        isDeployed: false,
      })
    )
    expect(canonicalState.lastSaved).toEqual(expect.any(Number))
    expect(applyWorkflowStateMock).toHaveBeenCalledWith(
      insertedWorkflow.id,
      expect.objectContaining({
        blocks: initialWorkflowState.blocks,
      }),
      insertedWorkflow.variables,
      'Workflow Copy'
    )
  })

  it('rolls back the workflow row when initial-state materialization fails', async () => {
    saveWorkflowToNormalizedTablesMock.mockImplementationOnce(async () => {
      callOrder.push('save')
      return {
        success: false,
        error: 'save failed',
      }
    })

    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(
      createRequest({
        name: 'Workflow Copy',
        workspaceId: 'workspace-1',
        initialWorkflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          variables: {},
        },
      })
    )

    expect(response.status).toBe(500)
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(deleteWhereMock).toHaveBeenCalledOnce()
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()
    expect(callOrder).toEqual(['apply', 'save'])
  })

  it('rolls back the workflow row when Yjs seeding fails', async () => {
    applyWorkflowStateMock.mockRejectedValueOnce(new Error('socket unavailable'))

    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(
      createRequest({
        name: 'Workflow Copy',
        workspaceId: 'workspace-1',
        initialWorkflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          variables: {},
        },
      })
    )

    expect(response.status).toBe(500)
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).not.toHaveBeenCalled()
    expect(deleteWhereMock).toHaveBeenCalledOnce()
  })

  it('seeds and materializes default workflow state when no initial state is provided', async () => {
    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(
      createRequest({
        name: 'Blank Workflow',
        workspaceId: 'workspace-1',
      })
    )

    expect(response.status).toBe(200)
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(callOrder).toEqual(['apply', 'save'])

    const insertedWorkflow = insertValuesMock.mock.calls[0][0]
    expect(insertedWorkflow.variables).toEqual({})
    expect(applyWorkflowStateMock).toHaveBeenCalledWith(
      insertedWorkflow.id,
      expect.objectContaining({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      }),
      {},
      'Blank Workflow'
    )
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledWith(
      insertedWorkflow.id,
      expect.objectContaining({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      })
    )
  })

  it('rejects workflow creation without workspace scope', async () => {
    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(createRequest({ name: 'Workflow Copy' }))

    expect(response.status).toBe(400)
    expect(insertValuesMock).not.toHaveBeenCalled()
  })
})
