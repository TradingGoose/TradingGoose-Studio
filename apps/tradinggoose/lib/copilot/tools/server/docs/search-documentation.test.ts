/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import * as baseTool from '@/lib/copilot/tools/server/base-tool'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'

const m = vi.hoisted(() => ({
  select: vi.fn(),
  embedding: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: m.select } }))
vi.mock('@tradinggoose/db/schema', () => ({ docsEmbeddings: {} }))
vi.mock('drizzle-orm', () => ({ sql: () => 'sql' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/embeddings/utils', () => ({ generateSearchEmbedding: m.embedding }))

import { searchDocumentationServerTool } from './search-documentation'

const completed = {
  model: 'openai/text-embedding-3-small',
  tokens: { prompt: 12, total: 12 },
  usage: { status: 'reported' as const, batches: 1 },
  cost: { status: 'unavailable' as const },
}
const accounting = {
  model: completed.model,
  tokens: completed.tokens,
  embeddingUsage: completed.usage,
  cost: completed.cost,
}
function ownedEmbedding() {
  return withInferenceFacts(
    { ...completed, embedding: [1, 2] },
    {
      ...accounting,
      generatedFields: ['model', 'tokens', 'cost'],
    }
  )
}
function mockIndexedSearch(queryResult: () => Promise<unknown[]> = async () => []) {
  m.select
    .mockReturnValueOnce({ from: () => ({ limit: async () => [{ chunkId: 'chunk-1' }] }) })
    .mockReturnValueOnce({ from: () => ({ orderBy: () => ({ limit: queryResult }) }) })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('COPILOT_RAG_SIMILARITY_THRESHOLD', undefined)
  m.select.mockReset()
  m.embedding.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('documentation search accounting', () => {
  it.each([
    [undefined, 2],
    ['0.85', 1],
    ['invalid', 2],
  ] as const)(
    'uses threshold %s with one embedding charge for all matching chunks',
    async (threshold, count) => {
      vi.stubEnv('COPILOT_RAG_SIMILARITY_THRESHOLD', threshold)
      mockIndexedSearch(async () => [{ similarity: 0.9 }, { similarity: 0.8 }])
      m.embedding.mockResolvedValue(ownedEmbedding())
      const result = await searchDocumentationServerTool.execute(
        { query: 'workflow docs' },
        { userId: 'user-1' }
      )
      expect(result.totalResults).toBe(count)
      expect(result.embeddingUsage).toEqual(completed)
      expect(m.embedding).toHaveBeenCalledTimes(1)
      expect(getInferenceFacts(result)).toMatchObject({
        ...accounting,
        generatedFields: expect.arrayContaining(['embeddingUsage']),
      })
    }
  )

  it.each(['post-embedding abort', 'vector query rejection'] as const)(
    'preserves completed accounting on %s',
    async (scenario) => {
      const controller = new AbortController()
      const databaseError = Object.assign(new Error('private database failure'), {
        statusCode: 503,
        apiKey: 'private-key',
      })
      mockIndexedSearch(async () => {
        if (scenario === 'vector query rejection') throw databaseError
        return []
      })
      m.embedding.mockImplementation(async () => {
        if (scenario === 'post-embedding abort') controller.abort()
        return ownedEmbedding()
      })
      const abortCheck = vi.spyOn(baseTool, 'throwIfServerToolAborted')
      const error = await searchDocumentationServerTool
        .execute({ query: 'docs' }, { userId: 'user-1', signal: controller.signal })
        .catch((failure) => failure)
      if (scenario === 'post-embedding abort') {
        expect(error.name).toBe('AbortError')
        expect(error).toBe(abortCheck.mock.results.at(-1)?.value)
      } else {
        expect(error).toBe(databaseError)
      }
      expect(Object.fromEntries(Object.entries(getFailureAccounting(error)))).toEqual(accounting)
      const response = buildCopilotServerToolErrorResponse('search_documentation', error)
      expect(response.status).toBe(500)
      expect(Object.fromEntries(Object.entries(response.body))).toEqual({
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
        ...accounting,
      })
      expect(m.embedding).toHaveBeenCalledTimes(1)
    }
  )

  it('skips model contact when no documentation is indexed', async () => {
    m.select.mockReturnValue({ from: () => ({ limit: async () => [] }) })
    await expect(
      searchDocumentationServerTool.execute({ query: 'docs' }, { userId: 'user-1' })
    ).resolves.toEqual({ results: [], query: 'docs', totalResults: 0 })
    expect(m.embedding).not.toHaveBeenCalled()
  })

  it.each([
    [
      new Error('API key not found for provider openai'),
      'search_documentation_unavailable',
      503,
      false,
    ],
    [
      Object.assign(new Error('upstream unavailable'), { statusCode: 503 }),
      'search_documentation_backend_failed',
      503,
      true,
    ],
  ] as const)(
    'returns structured errors for embedding failures',
    async (error, code, status, retryable) => {
      mockIndexedSearch()
      m.embedding.mockRejectedValue(error)
      await expect(
        searchDocumentationServerTool.execute({ query: 'docs' }, { userId: 'user-1' })
      ).rejects.toMatchObject({ name: 'StructuredServerToolError', code, status, retryable })
    }
  )
})

describe('authenticated documentation usage', () => {
  it('passes the authenticated Studio actor and selected workspace to embeddings', async () => {
    mockIndexedSearch()
    m.embedding.mockResolvedValue(ownedEmbedding())
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      signal: new AbortController().signal,
    }
    await searchDocumentationServerTool.execute({ query: 'docs' }, context)
    expect(m.embedding).toHaveBeenCalledExactlyOnceWith('docs', {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      signal: context.signal,
    })
  })
  it('requires authentication before any embedding or database read', async () => {
    await expect(searchDocumentationServerTool.execute({ query: 'docs' })).rejects.toThrow(
      'Authenticated'
    )
    expect(m.embedding).not.toHaveBeenCalled()
    expect(m.select).not.toHaveBeenCalled()
  })
})
