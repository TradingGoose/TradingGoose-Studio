/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { replaceWorkflowDocumentState } from '@/lib/yjs/workflow-session'

const {
  mockApplyWorkflowStateInSocketServer,
  mockDbUpdate,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
  mockGetYjsSnapshot,
  mockSaveWorkflowToNormalizedTables,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowStateInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
    mockGetYjsSnapshot: vi.fn(),
    mockSaveWorkflowToNormalizedTables: vi.fn(),
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
  getYjsSnapshot: mockGetYjsSnapshot,
}))

const emptyWorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }

function buildWorkflowSnapshotBase64(
  workflowState: Parameters<typeof replaceWorkflowDocumentState>[1],
  variables: Record<string, any> = {}
): string {
  const doc = new Y.Doc()
  try {
    replaceWorkflowDocumentState(doc, workflowState, variables, 'Workflow Name')
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  } finally {
    doc.destroy()
  }
}

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
    mockGetYjsSnapshot.mockImplementation(async () => ({
      snapshotBase64: buildWorkflowSnapshotBase64(emptyWorkflowState),
    }))
    mockUpdateReturning.mockResolvedValue([{ id: 'workflow-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it('persists the applied Yjs workflow state after publishing to Yjs', async () => {
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
    mockGetYjsSnapshot.mockResolvedValueOnce({
      snapshotBase64: buildWorkflowSnapshotBase64(
        {
          blocks: {
            'yjs-block': {
              id: 'yjs-block',
              type: 'agent',
              name: 'Yjs Agent',
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
        { apiKey: { id: 'apiKey', value: 'from-yjs' } }
      ),
    })

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

    expect(mockGetYjsSnapshot).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        targetKind: 'workflow',
        sessionId: 'workflow-1',
        workflowId: 'workflow-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
      })
    )
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledOnce()
    expect(mockSaveWorkflowToNormalizedTables.mock.calls[0][1]).toMatchObject({
      blocks: {
        'yjs-block': expect.objectContaining({ id: 'yjs-block' }),
      },
    })
    expect(mockSaveWorkflowToNormalizedTables.mock.calls[0][2]).toEqual(expect.any(Function))
    expect(mockApplyWorkflowStateInSocketServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetYjsSnapshot.mock.invocationCallOrder[0]
    )
    expect(mockGetYjsSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveWorkflowToNormalizedTables.mock.invocationCallOrder[0]
    )
    expect(mockSaveWorkflowToNormalizedTables.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbUpdate.mock.invocationCallOrder[0]
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { apiKey: { id: 'apiKey', value: 'from-yjs' } },
      })
    )
  })

  it('does not commit workflow DB changes when Yjs persistence fails', async () => {
    mockApplyWorkflowStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState, {})).rejects.toThrow(
      'fetch failed'
    )

    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
    expect(mockGetYjsSnapshot).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('preserves workflow Yjs state when DB persistence fails after Yjs apply', async () => {
    mockSaveWorkflowToNormalizedTables.mockResolvedValueOnce({
      success: false,
      error: 'db failed',
    })

    const { applyWorkflowState } = await import('./apply-workflow-state')

    await expect(applyWorkflowState('workflow-1', emptyWorkflowState, {})).rejects.toThrow(
      'db failed'
    )

    expect(mockApplyWorkflowStateInSocketServer).toHaveBeenCalledOnce()
    expect(mockGetYjsSnapshot).toHaveBeenCalledOnce()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
