/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyWorkflowStateInSocketServer,
  mockDbUpdate,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
  mockSaveWorkflowToNormalizedTables,
  mockDeleteYjsSessionInSocketServer,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowStateInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
    mockSaveWorkflowToNormalizedTables: vi.fn(),
    mockDeleteYjsSessionInSocketServer: vi.fn(),
    mockUpdateReturning: vi.fn(),
    mockUpdateSet: vi.fn(),
    mockUpdateWhere: vi.fn(),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
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
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyWorkflowStateInSocketServer: mockApplyWorkflowStateInSocketServer,
  deleteYjsSessionInSocketServer: mockDeleteYjsSessionInSocketServer,
}))

const emptyWorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }

describe('applyWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyWorkflowStateInSocketServer.mockResolvedValue(undefined)
    mockEnsureUniqueBlockIds.mockImplementation(async (_workflowId, state) => state)
    mockEnsureUniqueEdgeIds.mockImplementation(async (_workflowId, state) => state)
    mockSaveWorkflowToNormalizedTables.mockImplementation(async (_workflowId, state, commit) => {
      await commit?.({ update: mockDbUpdate }, state)
      return { success: true }
    })
    mockDeleteYjsSessionInSocketServer.mockResolvedValue(undefined)
    mockUpdateReturning.mockResolvedValue([{ id: 'workflow-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it('publishes the normalized workflow state to Yjs before committing DB changes', async () => {
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
      undefined,
      'Workflow Name'
    )

    expect(mockApplyWorkflowStateInSocketServer).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        blocks: {
          'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
        },
      }),
      undefined,
      'Workflow Name'
    )

    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledOnce()
    expect(mockSaveWorkflowToNormalizedTables.mock.calls[0][1]).toMatchObject({
      blocks: {
        'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
      },
    })
    expect(mockSaveWorkflowToNormalizedTables.mock.calls[0][2]).toEqual(expect.any(Function))
    expect(mockApplyWorkflowStateInSocketServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveWorkflowToNormalizedTables.mock.invocationCallOrder[0]
    )
    expect(mockSaveWorkflowToNormalizedTables.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbUpdate.mock.invocationCallOrder[0]
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({
        variables: expect.anything(),
      })
    )
  })

  it('does not commit workflow DB changes when Yjs persistence fails', async () => {
    mockApplyWorkflowStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState)).rejects.toThrow(
      'fetch failed'
    )

    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockDeleteYjsSessionInSocketServer).not.toHaveBeenCalled()
  })

  it('clears workflow Yjs state when DB persistence fails after Yjs apply', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValueOnce({
      success: false,
      error: 'db failed',
    })

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState)).rejects.toThrow('db failed')

    expect(mockDeleteYjsSessionInSocketServer).toHaveBeenCalledWith('workflow-1')
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
