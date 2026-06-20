import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { loadBaseWorkflowState } from '@/lib/copilot/tools/server/workflow/workflow-mutation-utils'
import { setWorkflowState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'

const mocks = vi.hoisted(() => ({
  readBootstrappedReviewTargetSnapshot: vi.fn(),
  verifyWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyWorkflowAccess: (...args: any[]) => mocks.verifyWorkflowAccess(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: (...args: any[]) =>
    mocks.readBootstrappedReviewTargetSnapshot(...args),
}))

function encodeWorkflowSnapshot(workflowState: WorkflowSnapshot): string {
  const doc = new Y.Doc()
  try {
    setWorkflowState(doc, workflowState, 'test')
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  } finally {
    doc.destroy()
  }
}

describe('workflow mutation Yjs loader', () => {
  beforeEach(() => {
    mocks.readBootstrappedReviewTargetSnapshot.mockReset()
    mocks.verifyWorkflowAccess.mockReset()
  })

  it('loads the base workflow state from an authorized Yjs snapshot', async () => {
    const workflowState: WorkflowSnapshot = {
      direction: 'TD',
      blocks: {
        fn1: {
          id: 'fn1',
          type: 'function',
          name: 'Function',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    mocks.verifyWorkflowAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
      userPermission: 'admin',
      isOwner: false,
    })
    mocks.readBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64: encodeWorkflowSnapshot(workflowState),
      descriptor: {},
      runtime: { docState: 'active', replaySafe: true, reseededFromCanonical: false },
    })

    const result = await loadBaseWorkflowState('workflow-1', {
      userId: 'user-1',
      workspaceId: 'workspace-from-context',
    })

    expect(mocks.verifyWorkflowAccess).toHaveBeenCalledWith('user-1', 'workflow-1', 'write')
    expect(mocks.readBootstrappedReviewTargetSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        draftSessionId: null,
        reviewSessionId: null,
        yjsSessionId: 'workflow-1',
      })
    )
    expect(result.blocks.fn1.name).toBe('Function')
  })

  it('rejects workflow edits without authenticated user context', async () => {
    await expect(loadBaseWorkflowState('workflow-1')).rejects.toThrow(
      'Authenticated user is required to edit workflow state'
    )

    expect(mocks.verifyWorkflowAccess).not.toHaveBeenCalled()
    expect(mocks.readBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
  })

  it('rejects workflow edits without write access', async () => {
    mocks.verifyWorkflowAccess.mockResolvedValue({
      hasAccess: false,
      workspaceId: 'workspace-1',
      userPermission: null,
      isOwner: false,
    })

    await expect(loadBaseWorkflowState('workflow-1', { userId: 'user-1' })).rejects.toThrow(
      'Access denied: You do not have permission to edit this workflow'
    )

    expect(mocks.readBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
  })
})
