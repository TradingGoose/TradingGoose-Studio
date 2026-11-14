/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockConsoleLogger } from '@/app/api/__test-utils__/utils'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  embeddings: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
}))
vi.mock('@/lib/embeddings/utils', () => ({ generateEmbeddings: mocks.embeddings }))
vi.mock('@/lib/tokenization/estimators', () => ({ getAccurateTokenCount: () => 3 }))
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ user: { id: 'actor-1' } }) }))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: async () => ({ success: true, userId: 'actor-1' }),
}))
vi.mock('@/lib/knowledge/chunks/service', () => ({
  createChunk: mocks.create,
  updateChunk: mocks.update,
  queryChunks: vi.fn(),
  batchChunkOperation: vi.fn(),
  deleteChunk: vi.fn(),
}))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: async () => ({
    hasAccess: true,
    document: { processingStatus: 'completed' },
    knowledgeBase: { workspaceId: 'workspace-1', userId: 'different-owner' },
  }),
  checkChunkAccess: async () => ({
    hasAccess: true,
    knowledgeBase: { workspaceId: 'workspace-1', userId: 'different-owner' },
  }),
  checkDocumentAccess: vi.fn(),
}))
mockConsoleLogger()

const completed = {
  model: 'openai/text-embedding-3-small',
  tokens: { prompt: 10, total: 10 },
  embeddingUsage: { status: 'partial', batches: 1 },
  cost: { status: 'unavailable' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('chunk embedding failure accounting', () => {
  it('returns completed usage through chunk creation HTTP failure', async () => {
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error('embedding batch failed'), completed)
    )
    const { POST } = await import('./[id]/documents/[documentId]/chunks/route')
    const response = await POST(createMockRequest('POST', { content: 'chunk' }), {
      params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }),
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create chunk', ...completed })
  })

  it('returns completed usage through chunk update HTTP failure', async () => {
    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error('embedding batch failed'), completed)
    )
    const { PUT } = await import('./[id]/documents/[documentId]/chunks/[chunkId]/route')
    const response = await PUT(createMockRequest('PUT', { content: 'updated chunk' }), {
      params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1', chunkId: 'chunk-1' }),
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update chunk', ...completed })
  })
})

describe('completed embedding accounting after chunk persistence failure', () => {
  const native = {
    model: 'openai/text-embedding-3-small',
    embeddings: [[0.1, 0.2]],
    tokens: { prompt: 10, total: 10 },
    usage: { status: 'reported', batches: 1 },
    cost: { status: 'unavailable' },
  }
  const accounting = {
    model: native.model,
    tokens: native.tokens,
    cost: native.cost,
    embeddingUsage: native.usage,
  }

  function selectResult(rows: unknown[]) {
    return { from: () => ({ where: () => ({ limit: async () => rows }) }) }
  }

  it('carries a successful embedding through a rejected create transaction and HTTP error', async () => {
    const service = await vi.importActual<typeof import('@/lib/knowledge/chunks/service')>(
      '@/lib/knowledge/chunks/service'
    )
    const failure = new Error('database unavailable after embedding')
    mocks.create.mockImplementationOnce(service.createChunk)
    mocks.select.mockReturnValueOnce(selectResult([{ embeddingModel: native.model }]))
    mocks.embeddings.mockResolvedValueOnce(native)
    mocks.transaction.mockImplementationOnce(async () => {
      expect(mocks.embeddings).toHaveBeenCalledOnce()
      throw failure
    })

    const { POST } = await import('./[id]/documents/[documentId]/chunks/route')
    const response = await POST(createMockRequest('POST', { content: 'chunk' }), {
      params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create chunk', ...accounting })
    expect(failure).toMatchObject({
      message: 'database unavailable after embedding',
      ...accounting,
    })
    await expect(mocks.create.mock.results[0].value).rejects.toBe(failure)
    expect(mocks.embeddings).toHaveBeenCalledExactlyOnceWith(
      ['chunk'],
      expect.objectContaining({ actorUserId: 'actor-1', workspaceId: 'workspace-1' }),
      native.model
    )
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('carries a successful embedding through rejected update persistence and HTTP error', async () => {
    const service = await vi.importActual<typeof import('@/lib/knowledge/chunks/service')>(
      '@/lib/knowledge/chunks/service'
    )
    const failure = new Error('database unavailable after embedding')
    mocks.update.mockImplementationOnce(service.updateChunk)
    mocks.embeddings.mockResolvedValueOnce(native)
    const select = vi
      .fn()
      .mockReturnValueOnce(
        selectResult([
          {
            documentId: 'doc-1',
            knowledgeBaseId: 'kb-1',
            content: 'old chunk',
            contentLength: 9,
            tokenCount: 2,
          },
        ])
      )
      .mockReturnValueOnce(selectResult([{ embeddingModel: native.model }]))
    mocks.transaction.mockImplementationOnce(async (callback) =>
      callback({
        select,
        update: () => ({
          set: () => ({
            where: async () => {
              expect(mocks.embeddings).toHaveBeenCalledOnce()
              throw failure
            },
          }),
        }),
      })
    )

    const { PUT } = await import('./[id]/documents/[documentId]/chunks/[chunkId]/route')
    const response = await PUT(createMockRequest('PUT', { content: 'updated chunk' }), {
      params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1', chunkId: 'chunk-1' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update chunk', ...accounting })
    expect(failure).toMatchObject({
      message: 'database unavailable after embedding',
      ...accounting,
    })
    await expect(mocks.update.mock.results[0].value).rejects.toBe(failure)
    expect(mocks.embeddings).toHaveBeenCalledExactlyOnceWith(
      ['updated chunk'],
      expect.objectContaining({ actorUserId: 'actor-1', workspaceId: 'workspace-1' }),
      native.model
    )
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })
})
