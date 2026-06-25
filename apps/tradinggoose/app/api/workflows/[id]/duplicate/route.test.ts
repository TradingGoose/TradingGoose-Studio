import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow Duplicate API Route', () => {
  let loadWorkflowStateMock: ReturnType<typeof vi.fn>
  let regenerateWorkflowStateIdsMock: ReturnType<typeof vi.fn>
  let saveWorkflowToNormalizedTablesMock: ReturnType<typeof vi.fn>
  let insertValuesMock: ReturnType<typeof vi.fn>
  let deleteWhereMock: ReturnType<typeof vi.fn>

  const sourceWorkflowRow = {
    id: 'workflow-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    folderId: 'folder-id',
    description: 'Source description',
    variables: {
      'db-var': {
        id: 'db-var',
        workflowId: 'workflow-id',
        name: 'fallbackVar',
        type: 'plain',
        value: 'fallback',
      },
    },
  }

  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost:3000/api/workflows/workflow-id/duplicate', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    loadWorkflowStateMock = vi.fn()
    regenerateWorkflowStateIdsMock = vi.fn((state) => JSON.parse(JSON.stringify(state)))
    saveWorkflowToNormalizedTablesMock = vi.fn(async (_workflowId, state) => ({
      success: true,
      normalizedState: state,
    }))
    insertValuesMock = vi.fn().mockResolvedValue(undefined)
    deleteWhereMock = vi.fn().mockResolvedValue(undefined)

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field, value) => ({ field, value })),
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      workflow: {
        id: 'id',
      },
    }))

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([sourceWorkflowRow]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: insertValuesMock,
        }),
        delete: vi.fn().mockReturnValue({
          where: deleteWhereMock,
        }),
      },
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
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
      loadEditableWorkflowState: loadWorkflowStateMock,
      regenerateWorkflowStateIds: regenerateWorkflowStateIdsMock,
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses the saved source graph and variables when duplicating a workflow', async () => {
    loadWorkflowStateMock.mockResolvedValue({
      blocks: {
        'live-block': {
          id: 'live-block',
          type: 'agent',
          name: 'Live Agent',
          position: { x: 1, y: 2 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
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

    const { POST } = await import('@/app/api/workflows/[id]/duplicate/route')
    const response = await POST(
      createRequest({ name: 'Workflow Copy', workspaceId: 'workspace-id' }),
      {
        params: Promise.resolve({ id: 'workflow-id' }),
      }
    )

    expect(response.status).toBe(201)
    expect(insertValuesMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()

    const insertedWorkflow = insertValuesMock.mock.calls[0][0]
    const persistedWorkflowId = saveWorkflowToNormalizedTablesMock.mock.calls[0][0]
    const persistedState = saveWorkflowToNormalizedTablesMock.mock.calls[0][1]

    expect(insertedWorkflow.id).toBe(persistedWorkflowId)
    expect(persistedState.blocks).toEqual(
      expect.objectContaining({
        [Object.keys(persistedState.blocks)[0]]: expect.objectContaining({
          name: 'Live Agent',
        }),
      })
    )
    expect(Object.keys(insertedWorkflow.variables)).toHaveLength(1)
    expect(Object.values(insertedWorkflow.variables)).toEqual([
      expect.objectContaining({
        name: 'liveVar',
        value: 'live value',
        workflowId: persistedWorkflowId,
      }),
    ])
    expect((Object.values(insertedWorkflow.variables)[0] as { id: string }).id).not.toBe('live-var')
  })

  it('rolls back the duplicate when normalized state persistence fails', async () => {
    loadWorkflowStateMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: Date.now(),
    })
    saveWorkflowToNormalizedTablesMock.mockResolvedValueOnce({
      success: false,
      error: 'normalized state unavailable',
    })

    const { POST } = await import('@/app/api/workflows/[id]/duplicate/route')
    const response = await POST(
      createRequest({ name: 'Workflow Copy', workspaceId: 'workspace-id' }),
      {
        params: Promise.resolve({ id: 'workflow-id' }),
      }
    )

    expect(response.status).toBe(500)
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(deleteWhereMock).toHaveBeenCalledOnce()
  })

  it('rejects duplication without workspace scope', async () => {
    const { POST } = await import('@/app/api/workflows/[id]/duplicate/route')
    const response = await POST(createRequest({ name: 'Workflow Copy' }), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(400)
    expect(insertValuesMock).not.toHaveBeenCalled()
  })
})
