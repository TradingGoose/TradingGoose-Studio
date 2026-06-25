import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { WORKFLOW_VARIABLE_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import {
  editWorkflowVariableServerTool,
  readWorkflowServerTool,
} from '@/lib/copilot/tools/server/entities/workflow'
import { createWorkflowSnapshot, setVariables, setWorkflowState } from '@/lib/yjs/workflow-session'

const mockDbLimit = vi.hoisted(() => vi.fn())
const mockReadBootstrappedReviewTargetSnapshot = vi.hoisted(() => vi.fn())
const mockVerifyWorkflowAccess = vi.hoisted(() => vi.fn())
const mockApplyWorkflowState = vi.hoisted(() => vi.fn())

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockDbLimit,
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyWorkflowAccess: (...args: any[]) => mockVerifyWorkflowAccess(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedReviewTargetSnapshot: (...args: any[]) =>
    mockReadBootstrappedReviewTargetSnapshot(...args),
}))

vi.mock('@/lib/yjs/server/apply-workflow-state', () => ({
  applyWorkflowState: (...args: any[]) => mockApplyWorkflowState(...args),
  applyWorkflowMetadata: vi.fn(),
}))

function workflowSnapshotBase64(
  variables: Record<string, any>,
  workflowState = createWorkflowSnapshot()
): string {
  const doc = new Y.Doc()
  setWorkflowState(doc, workflowState, 'test')
  setVariables(doc, variables, 'test')
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  doc.destroy()
  return encoded
}

describe('workflow variable server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockDbLimit.mockReset()
    mockReadBootstrappedReviewTargetSnapshot.mockReset()
    mockVerifyWorkflowAccess.mockReset()
    mockApplyWorkflowState.mockReset()
    mockDbLimit.mockResolvedValue([
      {
        id: 'wf-1',
        name: 'Strategy Workflow',
        workspaceId: 'workspace-1',
      },
    ])
    mockVerifyWorkflowAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadBootstrappedReviewTargetSnapshot.mockResolvedValue({
      snapshotBase64: workflowSnapshotBase64({
        'var-1': {
          id: 'var-1',
          workflowId: 'wf-1',
          name: 'riskLimit',
          type: 'number',
          value: 10,
        },
      }),
    })
  })

  it('returns workflow variables through read_workflow', async () => {
    const result = await readWorkflowServerTool.execute(
      { entityId: 'wf-1' },
      { userId: 'user-1', accessLevel: 'limited' }
    )

    expect(result.workflowVariableDocumentFormat).toBe(WORKFLOW_VARIABLE_DOCUMENT_FORMAT)
    expect(JSON.parse(result.workflowVariableDocument)).toEqual({
      variables: [{ variableId: 'var-1', name: 'riskLimit', type: 'number', value: 10 }],
    })
  })

  it('prepares a document-diff review while preserving existing variable ids', async () => {
    const result = await editWorkflowVariableServerTool.execute(
      {
        entityId: 'wf-1',
        documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          variables: [
            { variableId: 'var-1', name: 'riskLimit', type: 'number', value: 25 },
            { variableId: 'var-2', name: 'enabled', type: 'boolean', value: true },
          ],
        }),
      },
      { userId: 'user-1', accessLevel: 'limited' }
    )

    expect(result).toMatchObject({
      requiresReview: true,
      success: true,
      entityKind: 'workflow',
      entityId: 'wf-1',
      workspaceId: 'workspace-1',
      documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
      variables: {
        'var-1': {
          id: 'var-1',
          workflowId: 'wf-1',
          name: 'riskLimit',
          type: 'number',
          value: 25,
        },
        'var-2': {
          id: 'var-2',
          workflowId: 'wf-1',
          name: 'enabled',
          type: 'boolean',
          value: true,
        },
      },
    })
    expect(result.preview.documentDiff.before).toContain('riskLimit')
    expect(result.preview.documentDiff.after).toContain('enabled')
  })

  it('applies full-access workflow variable edits through workflow state persistence', async () => {
    const result = await editWorkflowVariableServerTool.execute(
      {
        entityId: 'wf-1',
        documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          variables: [
            { variableId: 'var-1', name: 'riskLimit', type: 'number', value: 25 },
            { variableId: 'var-2', name: 'enabled', type: 'boolean', value: true },
          ],
        }),
      },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(result.requiresReview).toBeUndefined()
    expect(result.preview).toBeUndefined()
    expect(result).toMatchObject({
      success: true,
      entityKind: 'workflow',
      entityId: 'wf-1',
      workspaceId: 'workspace-1',
      documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
    })
    expect(mockApplyWorkflowState).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({
        blocks: {},
        edges: [],
      }),
      result.variables
    )
  })

  it('rejects replacement documents that omit variable ids', async () => {
    await expect(
      editWorkflowVariableServerTool.execute(
        {
          entityId: 'wf-1',
          documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            variables: [{ name: 'riskLimit', type: 'number', value: 25 }],
          }),
        },
        { userId: 'user-1', accessLevel: 'full' }
      )
    ).rejects.toThrow()

    expect(mockApplyWorkflowState).not.toHaveBeenCalled()
  })
})
