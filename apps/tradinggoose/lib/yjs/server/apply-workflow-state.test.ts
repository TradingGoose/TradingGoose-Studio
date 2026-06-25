/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyWorkflowEntityNameInSocketServer,
  mockApplyWorkflowStateInSocketServer,
  mockDbUpdate,
  mockDbSelect,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
  mockSelectFrom,
  mockSelectLimit,
  mockSelectWhere,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowEntityNameInSocketServer: vi.fn(),
    mockApplyWorkflowStateInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbSelect: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
    mockSelectFrom: vi.fn(),
    mockSelectLimit: vi.fn(),
    mockSelectWhere: vi.fn(),
    mockUpdateReturning: vi.fn(),
    mockUpdateSet: vi.fn(),
    mockUpdateWhere: vi.fn(),
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
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyWorkflowEntityNameInSocketServer: mockApplyWorkflowEntityNameInSocketServer,
  applyWorkflowStateInSocketServer: mockApplyWorkflowStateInSocketServer,
}))

const emptyWorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }

describe('applyWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyWorkflowEntityNameInSocketServer.mockResolvedValue(undefined)
    mockApplyWorkflowStateInSocketServer.mockResolvedValue(undefined)
    mockEnsureUniqueBlockIds.mockImplementation(async (_workflowId, state) => state)
    mockEnsureUniqueEdgeIds.mockImplementation(async (_workflowId, state) => state)
    mockUpdateReturning.mockResolvedValue([{ id: 'workflow-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
    mockSelectLimit.mockResolvedValue([{ id: 'workflow-1', name: 'Renamed Workflow' }])
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit })
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
    mockDbSelect.mockReturnValue({ from: mockSelectFrom })
  })

  it('renames workflow entity metadata through the socket-owned Yjs document', async () => {
    const { applyWorkflowEntityName } = await import('./apply-workflow-state')

    const updatedWorkflow = await applyWorkflowEntityName('workflow-1', 'Renamed Workflow')

    expect(mockApplyWorkflowEntityNameInSocketServer).toHaveBeenCalledWith(
      'workflow-1',
      'Renamed Workflow'
    )
    expect(mockApplyWorkflowStateInSocketServer).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockDbSelect.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockApplyWorkflowEntityNameInSocketServer.mock.invocationCallOrder[0]
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
      'Workflow Name'
    )

    expect(mockApplyWorkflowStateInSocketServer).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        blocks: {
          'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
        },
      }),
      {},
      'Workflow Name'
    )
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('does not commit workflow DB changes when the Yjs socket apply fails', async () => {
    mockApplyWorkflowStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState, {})).rejects.toThrow(
      'fetch failed'
    )

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
