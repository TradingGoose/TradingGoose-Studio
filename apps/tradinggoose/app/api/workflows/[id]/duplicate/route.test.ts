import { NextRequest } from 'next/server'
/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow Duplicate API Route', () => {
  let loadWorkflowStateWithFallbackMock: ReturnType<typeof vi.fn>
  let remapVariableIdsMock: ReturnType<typeof vi.fn>
  let regenerateWorkflowStateIdsMock: ReturnType<typeof vi.fn>
  let saveWorkflowToNormalizedTablesMock: ReturnType<typeof vi.fn>
  let applyWorkflowStateMock: ReturnType<typeof vi.fn>
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

    loadWorkflowStateWithFallbackMock = vi.fn()
    remapVariableIdsMock = vi.fn((variables, newWorkflowId: string) =>
      Object.fromEntries(
        Object.values(variables as Record<string, any>).map((variable, index) => [
          `remapped-${index + 1}`,
          {
            ...variable,
            id: `remapped-${index + 1}`,
            workflowId: newWorkflowId,
          },
        ])
      )
    )
    regenerateWorkflowStateIdsMock = vi.fn((state) => JSON.parse(JSON.stringify(state)))
    saveWorkflowToNormalizedTablesMock = vi.fn().mockResolvedValue({ success: true })
    applyWorkflowStateMock = vi.fn().mockResolvedValue(undefined)
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
      getUserEntityPermissions: vi.fn().mockResolvedValue('write'),
    }))

    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn(() => 'request-id'),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowStateWithFallback: loadWorkflowStateWithFallbackMock,
      remapVariableIds: remapVariableIdsMock,
      regenerateWorkflowStateIds: regenerateWorkflowStateIdsMock,
      saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
    }))

    vi.doMock('@/lib/yjs/server/apply-workflow-state', () => ({
      applyWorkflowState: applyWorkflowStateMock,
    }))

    vi.doMock('@/lib/yjs/workflow-session', () => ({
      createWorkflowSnapshot: vi.fn((snapshot: Record<string, unknown>) => snapshot),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it(
    'prefers the live Yjs source graph and variables when duplicating a workflow',
    { timeout: 10_000 },
    async () => {
    loadWorkflowStateWithFallbackMock.mockResolvedValue({
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
      source: 'yjs',
    })

    const { POST } = await import('@/app/api/workflows/[id]/duplicate/route')
    const response = await POST(createRequest({ name: 'Workflow Copy' }), {
      params: Promise.resolve({ id: 'workflow-id' }),
    })

    expect(response.status).toBe(201)
    expect(insertValuesMock).toHaveBeenCalledOnce()
    expect(saveWorkflowToNormalizedTablesMock).toHaveBeenCalledOnce()
    expect(applyWorkflowStateMock).toHaveBeenCalledOnce()

    const insertedWorkflow = insertValuesMock.mock.calls[0][0]
    const appliedWorkflowId = applyWorkflowStateMock.mock.calls[0][0]
    const appliedSnapshot = applyWorkflowStateMock.mock.calls[0][1]
    const appliedVariables = applyWorkflowStateMock.mock.calls[0][2]
    const savedState = saveWorkflowToNormalizedTablesMock.mock.calls[0][1]

    expect(insertedWorkflow.id).toBe(appliedWorkflowId)
    expect(appliedSnapshot.blocks).toEqual(
      expect.objectContaining({
        [Object.keys(appliedSnapshot.blocks)[0]]: expect.objectContaining({
          name: 'Live Agent',
        }),
      })
    )
    expect(savedState.blocks).toEqual(
      expect.objectContaining({
        [Object.keys(savedState.blocks)[0]]: expect.objectContaining({
          name: 'Live Agent',
        }),
      })
    )
    expect(Object.keys(appliedVariables)).toHaveLength(1)
    expect(Object.values(appliedVariables)).toEqual([
      expect.objectContaining({
        name: 'liveVar',
        value: 'live value',
        workflowId: appliedWorkflowId,
      }),
    ])
      expect((Object.values(appliedVariables)[0] as { id: string }).id).not.toBe('live-var')
    }
  )
})
