/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const {
  mockApplyWorkflowStateInSocketServer,
  mockDbUpdate,
  mockEnsureUniqueBlockIds,
  mockEnsureUniqueEdgeIds,
  mockGetState,
  mockSaveWorkflowToNormalizedTables,
  mockStoreCanonicalState,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  return {
    mockApplyWorkflowStateInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockEnsureUniqueBlockIds: vi.fn(),
    mockEnsureUniqueEdgeIds: vi.fn(),
    mockGetState: vi.fn(),
    mockSaveWorkflowToNormalizedTables: vi.fn(),
    mockStoreCanonicalState: vi.fn(),
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
}))

vi.mock('@/socket-server/yjs/persistence', () => ({
  getState: mockGetState,
  storeCanonicalState: mockStoreCanonicalState,
}))

describe('applyWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyWorkflowStateInSocketServer.mockResolvedValue(undefined)
    mockEnsureUniqueBlockIds.mockImplementation(async (_workflowId, state) => state)
    mockEnsureUniqueEdgeIds.mockImplementation(async (_workflowId, state) => state)
    mockGetState.mockResolvedValue(null)
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mockStoreCanonicalState.mockResolvedValue(undefined)
    mockUpdateReturning.mockResolvedValue([{ id: 'workflow-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it('publishes the normalized workflow state to Yjs and DB while preserving existing variables', async () => {
    mockApplyWorkflowStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))
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
    const { extractPersistedStateFromDoc, getMetadataMap, setVariables } = await import(
      '@/lib/yjs/workflow-session'
    )

    const existingDoc = new Y.Doc()
    setVariables(
      existingDoc,
      { var1: { id: 'var1', workflowId: 'workflow-1', name: 'token', value: 'secret' } },
      'test'
    )
    mockGetState.mockResolvedValueOnce(Y.encodeStateAsUpdate(existingDoc))
    existingDoc.destroy()

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

    expect(mockStoreCanonicalState).toHaveBeenCalledOnce()
    expect(mockStoreCanonicalState.mock.calls[0][0]).toBe('workflow-1')

    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, mockStoreCanonicalState.mock.calls[0][1] as Uint8Array)
      expect(extractPersistedStateFromDoc(doc)).toMatchObject({
        blocks: {
          'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
        },
        variables: {
          var1: expect.objectContaining({ value: 'secret' }),
        },
      })
      expect(extractPersistedStateFromDoc(doc).blocks).not.toHaveProperty('input-block')
      expect(getMetadataMap(doc).get('entityName')).toBe('Workflow Name')
    } finally {
      doc.destroy()
    }

    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledOnce()
    expect(mockSaveWorkflowToNormalizedTables.mock.calls[0][1]).toMatchObject({
      blocks: {
        'normalized-block': expect.objectContaining({ id: 'normalized-block' }),
      },
    })
    expect(mockSaveWorkflowToNormalizedTables.mock.invocationCallOrder[0]).toBeLessThan(
      mockStoreCanonicalState.mock.invocationCallOrder[0]
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({
        variables: expect.anything(),
      })
    )
  })
})
