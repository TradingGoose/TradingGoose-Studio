/**
 * @vitest-environment node
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPersistedStateFromDoc, setWorkflowState } from '@/lib/yjs/workflow-session'
import { cleanupPersistence } from './persistence'
import { cleanupAllDocuments, getDocument, getExistingDocument, setPersistence, setupWSConnection } from './upstream-utils'

vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(() => null),
  getRedisStorageMode: vi.fn(() => 'local'),
}))

const mockGetState = vi.fn(async () => null)
const mockStoreState = vi.fn(async () => {})
let lastStoredState: Uint8Array | null = null

class MockWebSocket extends EventEmitter {
  binaryType = 'arraybuffer'
  readyState = 1
  closed = false
  send = vi.fn((_: Uint8Array, __: Record<string, unknown>, callback?: (err?: Error | null) => void) => {
    callback?.(null)
  })
  ping = vi.fn()
  close = vi.fn(() => {
    if (this.closed) {
      return
    }

    this.closed = true
    this.readyState = 3
    this.emit('close')
  })
}

function createRequest(sessionId: string): IncomingMessage {
  return {
    url: `/yjs/${encodeURIComponent(sessionId)}`,
    headers: { host: 'localhost:3000' },
  } as IncomingMessage
}

function makeWorkflowState(name: string) {
  return {
    blocks: {
      block1: {
        id: 'block1',
        type: 'agent',
        name,
        position: { x: 10, y: 20 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        locked: false,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: 0,
        data: {},
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: '2026-04-06T00:00:00.000Z',
    isDeployed: false,
  }
}

beforeEach(() => {
  cleanupAllDocuments()
  cleanupPersistence()
  mockGetState.mockClear()
  mockStoreState.mockClear()
  lastStoredState = null
})

afterEach(() => {
  cleanupAllDocuments()
  cleanupPersistence()
  vi.clearAllMocks()
})

describe('socket-server yjs upstream utils', () => {
  it('flushes the latest state before disconnect cleanup removes persistence hooks', async () => {
    const sessionId = 'workflow-final-flush'
    setPersistence(sessionId, {
      getState: mockGetState,
      storeState: mockStoreState,
    })

    const doc = getDocument(sessionId)
    await getExistingDocument(sessionId)

    const ws = new MockWebSocket()
    setupWSConnection(ws as any, createRequest(sessionId), { docId: sessionId, gc: true })

    setWorkflowState(doc, makeWorkflowState('Initial Agent'), 'test')
    setWorkflowState(doc, makeWorkflowState('Updated Agent'), 'test')

    ws.close()

    await vi.waitFor(() => {
      expect(mockStoreState).toHaveBeenCalled()
    })

    const lastStoreCall = mockStoreState.mock.calls.at(-1) as [string, Uint8Array] | undefined
    lastStoredState = lastStoreCall?.[1] ?? null
    expect(lastStoredState).toBeInstanceOf(Uint8Array)

    const persistedDoc = new Y.Doc()
    try {
      Y.applyUpdate(persistedDoc, lastStoredState as Uint8Array)
      const persistedState = extractPersistedStateFromDoc(persistedDoc)
      expect(persistedState.blocks.block1).toEqual(
        expect.objectContaining({
          id: 'block1',
          name: 'Updated Agent',
        })
      )
    } finally {
      persistedDoc.destroy()
    }

    await vi.waitFor(async () => {
      expect(await getExistingDocument(sessionId)).toBeNull()
    })
  })
})
