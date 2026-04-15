/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const mockGetBlocksMetadataExecute = vi.fn()
const mockGetYjsSnapshot = vi.fn()
const mockGetEntityFields = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {},
}))

vi.mock('@tradinggoose/db/schema', () => ({
  copilotReviewItems: {},
  copilotReviewSessions: {},
  document: {},
  knowledgeBase: {},
  templates: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool', () => ({
  getBlocksMetadataServerTool: {
    execute: mockGetBlocksMetadataExecute,
  },
}))

vi.mock('@/lib/copilot/review-sessions/identity', () => ({
  buildYjsTransportEnvelope: vi.fn((descriptor) => descriptor),
  deriveYjsSessionId: vi.fn(({ reviewSessionId }) => reviewSessionId),
  serializeYjsTransportEnvelope: vi.fn((value) => value),
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  SocketServerBridgeError: class SocketServerBridgeError extends Error {
    status: number

    constructor(status: number) {
      super(`socket bridge ${status}`)
      this.status = status
    }
  },
  getYjsSnapshot: mockGetYjsSnapshot,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityFields: mockGetEntityFields,
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadWorkflowStateWithFallback: vi.fn(),
}))

vi.mock('@/lib/workflows/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((value) => value),
}))

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
    mockGetYjsSnapshot.mockReset()
    mockGetEntityFields.mockReset()
  })

  it('expands block contexts through the canonical blockIds path', async () => {
    mockGetBlocksMetadataExecute.mockResolvedValue({
      metadata: {
        'block-1': {
          blockType: 'block-1',
          blockName: 'RSI',
          blockDescription: 'Relative Strength Index',
        },
      },
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [{ kind: 'blocks', blockIds: ['block-1'], label: 'RSI' }],
      'user-1'
    )

    expect(mockGetBlocksMetadataExecute).toHaveBeenCalledWith({ blockIds: ['block-1'] })
    expect(result).toEqual([
      {
        type: 'blocks',
        tag: '@RSI',
        content: JSON.stringify({
          metadata: {
            'block-1': {
              blockType: 'block-1',
              blockName: 'RSI',
              blockDescription: 'Relative Strength Index',
            },
          },
        }),
      },
    ])
  })

  it('hydrates current entity contexts from Yjs review state before falling back to DB', async () => {
    const doc = new Y.Doc()
    const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')

    mockGetYjsSnapshot.mockResolvedValue({
      snapshotBase64,
      descriptor: {},
      runtime: { docState: 'active', replaySafe: true, reseededFromCanonical: false },
    })
    mockGetEntityFields.mockReturnValue({
      name: 'Live Skill',
      description: 'Fresh description',
      content: 'Newest live content',
    })

    const { processContextsServer } = await import('@/lib/copilot/process-contents')
    const result = await processContextsServer(
      [
        {
          kind: 'current_skill',
          label: 'Current Skill',
          workspaceId: 'workspace-1',
          skillId: 'skill-1',
          reviewSessionId: 'review-skill-1',
          draftSessionId: 'draft-skill-1',
        },
      ],
      'user-1'
    )

    expect(mockGetYjsSnapshot).toHaveBeenCalled()
    expect(result).toEqual([
      {
        type: 'current_skill',
        tag: '@Current Skill',
        content: JSON.stringify(
          {
            id: 'skill-1',
            workspaceId: 'workspace-1',
            name: 'Live Skill',
            description: 'Fresh description',
            content: 'Newest live content',
          },
          null,
          2
        ),
      },
    ])
  })
})
