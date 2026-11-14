import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kb: vi.fn(),
  embed: vi.fn(),
  search: vi.fn(),
  authorize: vi.fn(),
}))
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mocks.kb,
  createKnowledgeBase: vi.fn(),
}))
vi.mock('@/lib/yjs/entity-state', () => ({ savedEntityRowToContent: vi.fn() }))
vi.mock('../entities/shared', () => ({ verifySavedEntityContext: mocks.authorize }))
vi.mock('@/app/api/knowledge/search/utils', () => ({
  generateSearchEmbedding: mocks.embed,
  getQueryStrategy: () => ({ distanceThreshold: 0.5 }),
  handleVectorOnlySearch: mocks.search,
}))

import { queryKnowledgeBaseServerTool } from './knowledge-base'

const completed = {
  model: 'openai/text-embedding-3-small',
  embedding: [1, 2],
  tokens: { prompt: 4, total: 4 },
  usage: { status: 'reported', batches: 1 },
  cost: { status: 'unavailable' },
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.kb.mockResolvedValue({
    id: 'kb-1',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
    embeddingModel: completed.model,
  })
  mocks.embed.mockResolvedValue(completed)
})

describe('Copilot query knowledge embedding boundary', () => {
  it('keeps the authenticated member rather than substituting the knowledge owner', async () => {
    mocks.search.mockResolvedValue([])
    await queryKnowledgeBaseServerTool.execute(
      { entityId: 'kb-1', query: 'question' },
      { userId: 'member-1' }
    )
    expect(mocks.embed).toHaveBeenCalledExactlyOnceWith(
      'question',
      {
        actorUserId: 'member-1',
        workspaceId: 'workspace-1',
        signal: undefined,
      },
      completed.model
    )
  })

  it('retains completed vectors/usage after later vector query failure without embedding again', async () => {
    const failure = new Error('vector query failed')
    mocks.search.mockRejectedValue(failure)
    await expect(
      queryKnowledgeBaseServerTool.execute(
        { entityId: 'kb-1', query: 'question' },
        { userId: 'member-1' }
      )
    ).rejects.toMatchObject({
      message: 'vector query failed',
      model: completed.model,
      tokens: completed.tokens,
      cost: completed.cost,
      embeddingUsage: completed.usage,
      completedEmbeddings: [completed.embedding],
    })
    expect(mocks.embed).toHaveBeenCalledOnce()
  })

  it('refuses to infer a financial actor from stored knowledge ownership', async () => {
    await expect(
      queryKnowledgeBaseServerTool.execute({ entityId: 'kb-1', query: 'question' })
    ).rejects.toThrow(/actor/)
    expect(mocks.embed).not.toHaveBeenCalled()
  })
})
