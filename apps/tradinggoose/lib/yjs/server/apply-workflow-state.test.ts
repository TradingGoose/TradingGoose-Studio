/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockApplyWorkflowPatchInSocketServer,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowPatchInSocketServer: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
  }
})

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
      {}
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
      })
    )
  })

  it('surfaces socket apply failures', async () => {
    mockApplyWorkflowPatchInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState, {})).rejects.toThrow(
      'fetch failed'
    )
  })
})
