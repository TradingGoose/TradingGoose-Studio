/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow API Route', () => {
  const insertValuesMock = vi.fn()
  const deleteWhereMock = vi.fn()
  const saveWorkflowToNormalizedTablesMock = vi.fn()
  const tryApplyWorkflowStateMock = vi.fn()

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

    insertValuesMock.mockResolvedValue(undefined)
    deleteWhereMock.mockResolvedValue(undefined)
    saveWorkflowToNormalizedTablesMock.mockResolvedValue({ success: true })
    tryApplyWorkflowStateMock.mockResolvedValue({ success: true })

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
      workspace: {
        id: 'workspace.id',
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
      getUserEntityPermissions: vi.fn().mockResolvedValue('write'),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      tryApplyWorkflowState: tryApplyWorkflowStateMock,
    }))

    vi.doMock('@/lib/telemetry/tracer', () => ({
      trackPlatformEvent: vi.fn(),
    }))
  })

  it('persists initial workflow state canonically before seeding Yjs', async () => {
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
        initialWorkflowState,
      })
    )

    expect(response.status).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(tryApplyWorkflowStateMock).toHaveBeenCalledOnce()

    const insertedWorkflow = insertValuesMock.mock.calls[0][0]
    const canonicalState = saveWorkflowToNormalizedTablesMock.mock.calls[0][1]

    expect(insertedWorkflow.variables).toEqual(initialWorkflowState.variables)
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
    expect(tryApplyWorkflowStateMock).toHaveBeenCalledWith(
      insertedWorkflow.id,
      expect.objectContaining({
        blocks: initialWorkflowState.blocks,
      }),
      initialWorkflowState.variables
    )
  })

  it('rolls back the workflow row when canonical initial-state persistence fails', async () => {
    saveWorkflowToNormalizedTablesMock.mockResolvedValueOnce({
      success: false,
      error: 'save failed',
    })

    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(
      createRequest({
        name: 'Workflow Copy',
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
    expect(tryApplyWorkflowStateMock).not.toHaveBeenCalled()
  })
})
