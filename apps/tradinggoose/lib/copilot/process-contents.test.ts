/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetBlocksMetadataExecute = vi.fn()

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

describe('processContextsServer', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetBlocksMetadataExecute.mockReset()
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
})
