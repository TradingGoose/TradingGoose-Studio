/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyWorkflowPatchInSocketServer,
  mockDbUpdate,
  mockDbSelect,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
  mockSelectFrom,
  mockSelectLimit,
  mockSelectWhere,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowPatchInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbSelect: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
    mockSelectFrom: vi.fn(),
    mockSelectLimit: vi.fn(),
    mockSelectWhere: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
  },
  workflow: {
    id: 'workflow.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  ensureUniqueBlockIds: mockEnsureUniqueBlockIds,
  ensureUniqueEdgeIds: mockEnsureUniqueEdgeIds,
  WorkflowRealtimeRequiredError: class WorkflowRealtimeRequiredError extends Error {
    readonly code = 'WORKFLOW_REALTIME_REQUIRED'

    constructor(cause: unknown) {
      super(
        cause instanceof Error
          ? cause.message
          : 'Editable workflow realtime orchestration is required'
      )
      this.name = 'WorkflowRealtimeRequiredError'
    }
  },
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyWorkflowPatchInSocketServer: mockApplyWorkflowPatchInSocketServer,
}))

const emptyWorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }

describe('applyWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyWorkflowPatchInSocketServer.mockResolvedValue(undefined)
    mockEnsureUniqueBlockIds.mockImplementation(async (_workflowId, state) => state)
    mockEnsureUniqueEdgeIds.mockImplementation(async (_workflowId, state) => state)
    mockSelectLimit.mockResolvedValue([{ id: 'workflow-1', name: 'Renamed Workflow' }])
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit })
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
    mockDbSelect.mockReturnValue({ from: mockSelectFrom })
  })

  it('updates workflow entity metadata through the socket-owned Yjs document', async () => {
    const { applyWorkflowMetadata } = await import('./apply-workflow-state')

    const updatedWorkflow = await applyWorkflowMetadata('workflow-1', {
      name: 'Renamed Workflow',
      description: 'Updated description',
      folderId: 'folder-1',
    })

    expect(mockApplyWorkflowPatchInSocketServer).toHaveBeenCalledWith('workflow-1', {
      metadata: {
        name: 'Renamed Workflow',
        description: 'Updated description',
        folderId: 'folder-1',
      },
    })
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockDbSelect.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockApplyWorkflowPatchInSocketServer.mock.invocationCallOrder[0]
    )
    expect(updatedWorkflow).toMatchObject({ id: 'workflow-1', name: 'Renamed Workflow' })
  })

  it('publishes normalized workflow state to the socket-owned Yjs document', async () => {
    mockEnsureUniqueBlockIds.mockImplementationOnce(async () => ({
      blocks: {
        'normalized-block': {
          id: 'normalized-block',
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
    }))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await applyWorkflowState(
      'workflow-1',
      {
        blocks: {
          'input-block': {
            id: 'input-block',
            type: 'agent',
            name: 'Input Agent',
            position: { x: 0, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      {},
      { name: 'Workflow Name' }
    )

    expect(mockApplyWorkflowPatchInSocketServer).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        workflowState: expect.objectContaining({
          blocks: {
            'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
          },
        }),
        variables: {},
        metadata: { name: 'Workflow Name' },
      })
    )
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('does not commit workflow DB changes when the Yjs socket apply fails', async () => {
    mockApplyWorkflowPatchInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState, {})).rejects.toThrow(
      'fetch failed'
    )

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
