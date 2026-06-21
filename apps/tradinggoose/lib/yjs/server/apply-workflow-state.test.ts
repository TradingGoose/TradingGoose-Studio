/**
 * @vitest-environment node
 */

import * as Y from 'yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockSocketServerBridgeError,
  mockApplyWorkflowStateInSocketServer,
  mockDbUpdate,
  mockGetState,
  mockGetRedisStorageMode,
  mockSaveWorkflowToNormalizedTables,
  mockStoreCanonicalState,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => {
  class MockSocketServerBridgeError extends Error {
    constructor() {
      super('Socket server bridge failed')
      this.name = 'SocketServerBridgeError'
    }
  }

  return {
    MockSocketServerBridgeError,
    mockApplyWorkflowStateInSocketServer: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockGetState: vi.fn(),
    mockGetRedisStorageMode: vi.fn(),
    mockSaveWorkflowToNormalizedTables: vi.fn(),
    mockStoreCanonicalState: vi.fn(),
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

vi.mock('@/lib/redis', () => ({
  getRedisStorageMode: mockGetRedisStorageMode,
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyWorkflowStateInSocketServer: mockApplyWorkflowStateInSocketServer,
  SocketServerBridgeError: MockSocketServerBridgeError,
}))

vi.mock('@/socket-server/yjs/persistence', () => ({
  getState: mockGetState,
  storeCanonicalState: mockStoreCanonicalState,
}))

describe('applyWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisStorageMode.mockReturnValue('redis')
    mockApplyWorkflowStateInSocketServer.mockResolvedValue(undefined)
    mockGetState.mockResolvedValue(null)
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mockStoreCanonicalState.mockResolvedValue(undefined)
    mockUpdateWhere.mockResolvedValue(undefined)
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it('preserves canonical Yjs variables during direct graph-only persistence', async () => {
    mockApplyWorkflowStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

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
        blocks: {},
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
        variables: {
          var1: expect.objectContaining({ value: 'secret' }),
        },
      })
      expect(getMetadataMap(doc).get('entityName')).toBe('Workflow Name')
    } finally {
      doc.destroy()
    }

    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledOnce()
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({
        variables: expect.anything(),
      })
    )
  })
})
