/**
 * Tests for knowledge search utility functions
 * Focuses on testing core functionality with simplified mocking
 *
 * @vitest-environment node
 */

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveAzureOpenAIServiceConfig, resolveOpenAIServiceConfig } = vi.hoisted(() => ({
  resolveAzureOpenAIServiceConfig: vi.fn(),
  resolveOpenAIServiceConfig: vi.fn(),
}))

vi.mock('drizzle-orm', async () => await vi.importActual('drizzle-orm'))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
  },
}))
vi.mock('@tradinggoose/db/schema', () => ({
  document: {
    id: 'document.id',
    filename: 'document.filename',
    deletedAt: 'document.deleted_at',
    processingStatus: 'document.processing_status',
  },
  embedding: {
    id: 'embedding.id',
    content: 'embedding.content',
    documentId: 'embedding.document_id',
    chunkIndex: 'embedding.chunk_index',
    tag1: 'embedding.tag1',
    tag2: 'embedding.tag2',
    tag3: 'embedding.tag3',
    tag4: 'embedding.tag4',
    tag5: 'embedding.tag5',
    tag6: 'embedding.tag6',
    tag7: 'embedding.tag7',
    knowledgeBaseId: 'embedding.knowledge_base_id',
    enabled: 'embedding.enabled',
    embedding: 'embedding.embedding',
  },
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({
  retryWithExponentialBackoff: (fn: any) => fn(),
}))

const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)

vi.mock('@/lib/env', () => ({
  env: {},
  getEnv: (key: string) => process.env[key],
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureOpenAIServiceConfig,
  resolveOpenAIServiceConfig,
}))

import {
  generateSearchEmbedding,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
} from './utils'

const azureConfig = {
  apiKey: 'test-azure-key',
  endpoint: 'https://test.openai.azure.com',
  apiVersion: '2024-12-01-preview',
  embeddingModel: 'text-embedding-ada-002',
}
const openaiConfig = { defaultApiKey: 'test-openai-key', rotationKeys: [] }
const searchParams = {
  knowledgeBaseIds: ['kb-123'],
  topK: 10,
  filters: { tag1: 'api' },
  queryVector: JSON.stringify([0.1, 0.2, 0.3]),
  distanceThreshold: 0.8,
}

describe('Knowledge Search Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    })
    resolveAzureOpenAIServiceConfig.mockReset()
    resolveOpenAIServiceConfig.mockReset()
    resolveAzureOpenAIServiceConfig.mockResolvedValue({
      apiKey: null,
      endpoint: null,
      apiVersion: '2024-07-01-preview',
      embeddingModel: null,
    })
    resolveOpenAIServiceConfig.mockResolvedValue({
      defaultApiKey: null,
      rotationKeys: [],
    })
  })

  describe('SQL tag predicates', () => {
    const where = vi.fn()
    const limit = vi.fn()
    const orderBy = vi.fn()

    beforeEach(async () => {
      const { db } = await import('@tradinggoose/db')
      limit.mockReset().mockResolvedValue([])
      orderBy.mockReset().mockReturnValue({ limit })
      where.mockReset().mockReturnValue({
        limit,
        orderBy,
        then: (resolve: (rows: { id: string }[]) => unknown) =>
          Promise.resolve([{ id: 'matching-chunk' }]).then(resolve),
      })
      vi.mocked(db.select).mockReturnValue({
        from: () => ({ innerJoin: () => ({ where }) }),
      } as any)
    })

    it.each(['tags', 'tags-and-query'])(
      'uses case-insensitive same-tag OR and distinct-tag AND for %s',
      async (mode) => {
        const params = {
          knowledgeBaseIds: ['kb-1'],
          topK: 10,
          filters: { tag1: 'API|OR|Guide', tag2: 'private' },
        }
        if (mode === 'tags') await handleTagOnlySearch(params)
        else
          await handleTagAndVectorSearch({
            ...params,
            queryVector: '[0.1,0.2]',
            distanceThreshold: 1,
          })
        const predicate = new PgDialect().sqlToQuery(where.mock.calls[0][0])
        expect(predicate.sql).toContain(' OR ')
        expect(predicate.sql.toLowerCase()).toContain(' and ')
        expect(predicate.sql.match(/LOWER\(/g)).toHaveLength(6)
        expect(predicate.params).toEqual(expect.arrayContaining(['API', 'Guide', 'private']))
        expect(predicate.sql).not.toContain('1=1')
        if (mode === 'tags-and-query') {
          const vectorPredicate = new PgDialect().sqlToQuery(where.mock.calls[1][0])
          expect(vectorPredicate.params).toContain('matching-chunk')
        }
      }
    )

    it('rejects unknown slots instead of turning them into an always-true predicate', async () => {
      await expect(
        handleTagOnlySearch({
          knowledgeBaseIds: ['kb-1'],
          topK: 10,
          filters: { missing: 'private' },
        })
      ).rejects.toThrow('Unknown knowledge tag slot')
      expect(where).not.toHaveBeenCalled()
    })

    it.each([
      ['tags', 1],
      ['tags', 5],
      ['query', 1],
      ['query', 5],
      ['tags-and-query', 1],
      ['tags-and-query', 5],
    ] as const)(
      'preserves result fields, scope and limits for %s across %i KBs',
      async (mode, count) => {
        const { db } = await import('@tradinggoose/db')
        const knowledgeBaseIds = Array.from({ length: count }, (_, i) => `kb-${i}`)
        const search = { knowledgeBaseIds, topK: 10, filters: { tag7: 'private' } }
        const vector = { queryVector: '[0.1,0.2]', distanceThreshold: 0.8 }
        if (mode === 'tags') await handleTagOnlySearch(search)
        else if (mode === 'query') await handleVectorOnlySearch({ ...search, ...vector })
        else await handleTagAndVectorSearch({ ...search, ...vector })

        const projection = vi.mocked(db.select).mock.calls.at(-1)![0]
        expect(Object.keys(projection!)).toEqual(
          expect.arrayContaining([
            'id',
            'content',
            'documentId',
            'chunkIndex',
            'knowledgeBaseId',
            'distance',
            'tag1',
            'tag2',
            'tag3',
            'tag4',
            'tag5',
            'tag6',
            'tag7',
          ])
        )
        const predicates = where.mock.calls.map(([condition]) =>
          new PgDialect().sqlToQuery(condition)
        )
        expect(predicates.flatMap(({ params }) => params)).toEqual(
          expect.arrayContaining(knowledgeBaseIds)
        )
        expect(predicates[0].params).toContain('completed')
        expect(predicates[0].params).toContain(true)
        expect(limit).toHaveBeenCalledWith(count === 5 && mode !== 'tags-and-query' ? 7 : 10)
        if (mode === 'tags') expect(orderBy).not.toHaveBeenCalled()
        else expect(new PgDialect().sqlToQuery(orderBy.mock.calls[0][0]).sql).toContain('<=>')
      }
    )
  })

  describe.each([
    ['tag-only', handleTagOnlySearch],
    ['tag and vector', handleTagAndVectorSearch],
  ] as const)('%s validation', (mode, handler) => {
    it('rejects missing filters', async () => {
      await expect(handler({ ...searchParams, filters: {} })).rejects.toThrow(
        `Tag filters are required for ${mode} search`
      )
    })
  })

  describe.each([
    ['vector-only', handleVectorOnlySearch],
    ['tag and vector', handleTagAndVectorSearch],
  ] as const)('%s validation', (mode, handler) => {
    it.each(['queryVector', 'distanceThreshold'])('rejects missing %s', async (field) => {
      await expect(handler({ ...searchParams, [field]: undefined })).rejects.toThrow(
        `Query vector and distance threshold are required for ${mode} search`
      )
    })
  })

  describe('generateSearchEmbedding', () => {
    it('uses Azure OpenAI when KB-specific config is provided', async () => {
      resolveAzureOpenAIServiceConfig.mockResolvedValue(azureConfig)
      resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      expect(await generateSearchEmbedding('test query')).toEqual([0.1, 0.2, 0.3])
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({ 'api-key': 'test-azure-key' }),
        })
      )
    })

    it('uses OpenAI when no KB Azure config is provided', async () => {
      resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      expect(await generateSearchEmbedding('test query')).toEqual([0.1, 0.2, 0.3])
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-openai-key' }),
        })
      )
    })

    it('uses the default API version from Azure config', async () => {
      resolveAzureOpenAIServiceConfig.mockResolvedValue({
        ...azureConfig,
        apiVersion: '2024-07-01-preview',
        embeddingModel: 'custom-embedding-model',
      })
      resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      await generateSearchEmbedding('test query')
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('api-version=2024-07-01-preview'),
        expect.any(Object)
      )
    })

    it('uses the custom model name from Azure config', async () => {
      resolveAzureOpenAIServiceConfig.mockResolvedValue({
        ...azureConfig,
        embeddingModel: 'custom-embedding-model',
      })
      resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      await generateSearchEmbedding('test query', 'text-embedding-3-small')
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/custom-embedding-model/embeddings?api-version=2024-12-01-preview',
        expect.any(Object)
      )
    })

    it('rejects missing API configuration', async () => {
      await expect(generateSearchEmbedding('test query')).rejects.toThrow(
        'Either the OpenAI default API key or Azure OpenAI service config must be configured'
      )
    })

    it.each([
      ['Azure OpenAI', 404, 'Not Found', 'Deployment not found'],
      ['OpenAI', 429, 'Too Many Requests', 'Rate limit exceeded'],
    ] as const)('handles %s API errors', async (provider, status, statusText, text) => {
      if (provider === 'Azure OpenAI')
        resolveAzureOpenAIServiceConfig.mockResolvedValue(azureConfig)
      else resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      fetchSpy.mockResolvedValueOnce({ ok: false, status, statusText, text: async () => text })
      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')
    })

    it.each(['Azure OpenAI', 'OpenAI'])('sends the correct %s body', async (provider) => {
      if (provider === 'Azure OpenAI')
        resolveAzureOpenAIServiceConfig.mockResolvedValue(azureConfig)
      else resolveOpenAIServiceConfig.mockResolvedValue(openaiConfig)
      await generateSearchEmbedding(
        'test query',
        provider === 'Azure OpenAI' ? undefined : 'text-embedding-3-small'
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            ...(provider === 'OpenAI' ? { model: 'text-embedding-3-small' } : {}),
            encoding_format: 'float',
          }),
        })
      )
    })
  })

  describe('getDocumentNamesByIds', () => {
    it('should handle empty input gracefully', async () => {
      const { getDocumentNamesByIds } = await import('./utils')

      const result = await getDocumentNamesByIds([])

      expect(result).toEqual({})
    })
  })
})
