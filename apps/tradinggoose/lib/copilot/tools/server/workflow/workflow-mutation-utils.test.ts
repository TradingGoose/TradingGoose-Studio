import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { loadBaseWorkflowState } from '@/lib/copilot/tools/server/workflow/workflow-mutation-utils'
import { setVariables, setWorkflowState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'

const mocks = vi.hoisted(() => ({
  readBootstrappedReviewTargetSnapshot: vi.fn(),
  verifySavedEntityContext: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: (...args: any[]) => mocks.verifySavedEntityContext(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: (...args: any[]) =>
    mocks.readBootstrappedReviewTargetSnapshot(...args),
}))

function encodeWorkflowSnapshot(
  workflowState: WorkflowSnapshot,
  variables: Record<string, any> = {}
): string {
  const doc = new Y.Doc()
  try {
    setWorkflowState(doc, workflowState, 'test')
    setVariables(doc, variables, 'test')
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  } finally {
    doc.destroy()
  }
}

describe('workflow mutation Yjs loader', () => {
  beforeEach(() => {
    mocks.readBootstrappedReviewTargetSnapshot.mockReset()
    mocks.verifySavedEntityContext.mockReset()
    mocks.verifySavedEntityContext.mockResolvedValue({ workspaceId: 'workspace-1' })
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

    mocks.readBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64: encodeWorkflowSnapshot(workflowState, {
        token: { id: 'token', name: 'token', value: 'secret' },
      }),
      descriptor: {},
      runtime: { docState: 'active' },
    })

    const result = await loadBaseWorkflowState('workflow-1', {
      userId: 'user-1',
      workspaceId: 'workspace-from-context',
    })

    expect(mocks.verifySavedEntityContext).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-from-context' },
      'workflow',
      'workflow-1',
      'write'
    )
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
    expect(result.variables.token).toMatchObject({
      id: 'token',
      name: 'token',
      value: 'secret',
    })
  })

  it('rejects workflow edits without authenticated user context', async () => {
    mocks.verifySavedEntityContext.mockRejectedValueOnce(
      new Error('Authenticated user is required to edit workflow state')
    )
    await expect(loadBaseWorkflowState('workflow-1')).rejects.toThrow(
      'Authenticated user is required to edit workflow state'
    )

    expect(mocks.readBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
  })

  it('rejects workflow edits without write access', async () => {
    mocks.verifySavedEntityContext.mockRejectedValueOnce(
      new Error('Access denied: You do not have permission to edit this workflow')
    )

    await expect(loadBaseWorkflowState('workflow-1', { userId: 'user-1' })).rejects.toThrow(
      'Access denied: You do not have permission to edit this workflow'
    )

    expect(mocks.readBootstrappedReviewTargetSnapshot).not.toHaveBeenCalled()
  })
})
