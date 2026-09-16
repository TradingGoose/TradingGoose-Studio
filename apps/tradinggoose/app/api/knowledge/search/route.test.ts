/**
 * Route contracts use service mocks; SQL behavior is exercised in utils.test.ts.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockConsoleLogger } from '@/app/api/__test-utils__/utils'
import { knowledgeSearchTool } from '@/tools/knowledge/search'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  workflowScope: vi.fn(),
  access: vi.fn(),
  tags: vi.fn(),
  tagSearch: vi.fn(),
  vectorSearch: vi.fn(),
  combinedSearch: vi.fn(),
  strategy: vi.fn(),
  embedding: vi.fn(),
  documentNames: vi.fn(),
  tokenCount: vi.fn(),
  cost: vi.fn(),
}))

vi.mock('@/tools/schema-enrichers', () => ({ enrichKBTagFiltersSchema: vi.fn() }))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.workflowScope }))
vi.mock('@/app/api/knowledge/utils', () => ({ checkKnowledgeBaseAccess: mocks.access }))
vi.mock('@/lib/knowledge/tags/service', () => ({ getDocumentTagDefinitions: mocks.tags }))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'test-request-id' }))
vi.mock('@/lib/tokenization/estimators', () => ({ estimateTokenCount: mocks.tokenCount }))
vi.mock('@/providers/ai/utils', () => ({ calculateCost: mocks.cost }))
vi.mock('./utils', () => ({
  handleTagOnlySearch: mocks.tagSearch,
  handleVectorOnlySearch: mocks.vectorSearch,
  handleTagAndVectorSearch: mocks.combinedSearch,
  getQueryStrategy: mocks.strategy,
  generateSearchEmbedding: mocks.embedding,
  getDocumentNamesByIds: mocks.documentNames,
}))
mockConsoleLogger()

const knowledgeBase = {
  id: 'kb-123',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  embeddingModel: 'text-embedding-3-small',
  name: 'Test KB',
  deletedAt: null,
}
const validSearchData = {
  knowledgeBaseIds: 'kb-123',
  query: 'test search query',
  topK: 10,
}
const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
const searchResults = [
  {
    id: 'chunk-1',
    content: 'This is a test chunk',
    documentId: 'doc-1',
    chunkIndex: 0,
    metadata: { title: 'Test Document' },
    distance: 0.2,
  },
  {
    id: 'chunk-2',
    content: 'Another test chunk',
    documentId: 'doc-2',
    chunkIndex: 1,
    metadata: { title: 'Another Document' },
    distance: 0.3,
  },
]
const tagDefinitions = [
  { tagSlot: 'tag1', displayName: 'category' },
  { tagSlot: 'tag2', displayName: 'priority' },
]
const taggedResults = [
  {
    ...searchResults[0],
    content: 'Tagged content 1',
    tag1: 'api',
    tag2: 'high',
    distance: 0,
    knowledgeBaseId: 'kb-123',
  },
  {
    ...searchResults[1],
    content: 'Tagged content 2',
    tag1: 'docs',
    tag2: 'medium',
    distance: 0,
    knowledgeBaseId: 'kb-123',
  },
]
const pricing = { input: 0.02, output: 0, updatedAt: '2025-07-10' }

async function search(body: unknown = validSearchData) {
  const { POST } = await import('./route')
  const response = await POST(createMockRequest('POST', body))
  return { response, data: await response.json() }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ success: true, userId: 'user-123' })
  mocks.workflowScope.mockResolvedValue({
    ok: true,
    userId: 'user-123',
    workspaceId: 'workspace-123',
    workflowId: 'workflow-123',
  })
  mocks.access.mockImplementation(async (id) => ({
    hasAccess: true,
    knowledgeBase: { ...knowledgeBase, id },
  }))
  mocks.tags.mockResolvedValue([])
  mocks.tagSearch.mockResolvedValue(taggedResults)
  mocks.vectorSearch.mockResolvedValue(searchResults)
  mocks.combinedSearch.mockResolvedValue(searchResults)
  mocks.strategy.mockReturnValue({ useParallel: false, distanceThreshold: 1 })
  mocks.embedding.mockResolvedValue(embedding)
  mocks.documentNames.mockResolvedValue({ doc1: 'Document 1', doc2: 'Document 2' })
  mocks.tokenCount.mockReturnValue({ count: 521 })
  mocks.cost.mockReturnValue({ input: 0.00001042, output: 0, total: 0.00001042, pricing })
})

describe('Knowledge Search API Route', () => {
  describe('POST /api/knowledge/search', () => {
    it.each([{ knowledgeBaseIds: 'kb-123' }, { knowledgeBaseIds: ['kb-123', 'kb-456'] }])(
      'performs vector search for $knowledgeBaseIds',
      async ({ knowledgeBaseIds }) => {
        const { response, data } = await search({ ...validSearchData, knowledgeBaseIds })
        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
        expect(data.data.results).toHaveLength(2)
        expect(data.data.results[0].similarity).toBe(0.8)
        expect(data.data.query).toBe(validSearchData.query)
        const ids = Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds : [knowledgeBaseIds]
        expect(data.data.knowledgeBaseIds).toEqual(ids)
        expect(mocks.vectorSearch).toHaveBeenCalledWith({
          knowledgeBaseIds: ids,
          topK: 10,
          queryVector: JSON.stringify(embedding),
          distanceThreshold: expect.any(Number),
        })
      }
    )

    it('handles workflow-based authentication', async () => {
      const { response, data } = await search({ ...validSearchData, workflowId: 'workflow-123' })
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mocks.workflowScope).toHaveBeenCalledWith(
        { success: true, userId: 'user-123' },
        'workflow-123',
        'read'
      )
    })

    it('returns unauthorized for an unauthenticated request', async () => {
      mocks.auth.mockResolvedValue({ success: false })
      const { response, data } = await search()
      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns not found for a workflow that does not exist', async () => {
      mocks.workflowScope.mockResolvedValue({ ok: false, error: 'Workflow not found', status: 404 })
      const { response, data } = await search({
        ...validSearchData,
        workflowId: 'nonexistent-workflow',
      })
      expect(response.status).toBe(404)
      expect(data.error).toBe('Workflow not found')
    })

    it.each([
      { knowledgeBaseIds: 'kb-123', missingId: 'kb-123' },
      { knowledgeBaseIds: ['kb-123', 'kb-missing'], missingId: 'kb-missing' },
    ])(
      'rejects missing knowledge bases in $knowledgeBaseIds',
      async ({ knowledgeBaseIds, missingId }) => {
        mocks.access.mockImplementation(async (id) =>
          id === missingId
            ? { hasAccess: false, notFound: true }
            : { hasAccess: true, knowledgeBase: { ...knowledgeBase, id } }
        )
        const { response, data } = await search({ ...validSearchData, knowledgeBaseIds })
        expect(response.status).toBe(404)
        expect(data.error).toBe('Knowledge base not found or access denied')
      }
    )

    it('validates search parameters', async () => {
      const { response, data } = await search({ knowledgeBaseIds: '', query: '', topK: 150 })
      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('uses the default topK when not provided', async () => {
      const { response, data } = await search({
        knowledgeBaseIds: 'kb-123',
        query: 'test search query',
      })
      expect(response.status).toBe(200)
      expect(data.data.topK).toBe(10)
    })

    it.each([
      ['OpenAI API error', mocks.embedding, 'OpenAI API error: 401 Unauthorized - Invalid API key'],
      ['missing API key', mocks.embedding, 'OPENAI_API_KEY not configured'],
      ['database error', mocks.vectorSearch, 'Database error'],
      [
        'invalid OpenAI response',
        mocks.embedding,
        'Invalid response format from OpenAI embeddings API',
      ],
    ] as const)('handles %s', async (_name, dependency, message) => {
      dependency.mockRejectedValueOnce(new Error(message))
      const { response, data } = await search()
      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to perform vector search')
      expect(dependency).toHaveBeenCalled()
    })

    describe('Cost tracking', () => {
      it('includes cost information in a successful response', async () => {
        const { response, data } = await search()
        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
        expect(data.data.cost).toBeDefined()
        expect(data.data.cost.input).toBe(0.00001042)
        expect(data.data.cost.output).toBe(0)
        expect(data.data.cost.total).toBe(0.00001042)
        expect(data.data.cost.tokens).toEqual({ prompt: 521, completion: 0, total: 521 })
        expect(data.data.cost.model).toBe('text-embedding-3-small')
        expect(data.data.cost.pricing).toEqual(pricing)
      })

      it('calls cost calculation functions with the correct parameters', async () => {
        mocks.access.mockResolvedValue({
          hasAccess: true,
          knowledgeBase: { ...knowledgeBase, embeddingModel: 'text-embedding-ada-002' },
        })
        await search()
        expect(mocks.tokenCount).toHaveBeenCalledWith('test search query', 'openai')
        expect(mocks.embedding).toHaveBeenCalledWith('test search query', 'text-embedding-ada-002')
        expect(mocks.cost).toHaveBeenCalledWith('text-embedding-ada-002', 521, 0, false)
      })

      it('handles cost calculation with a longer query', async () => {
        mocks.tokenCount.mockReturnValue({
          count: 1042,
          confidence: 'high',
          provider: 'openai',
          method: 'precise',
        })
        mocks.cost.mockReturnValue({ input: 0.00002084, output: 0, total: 0.00002084, pricing })
        const { response, data } = await search({
          ...validSearchData,
          query:
            'This is a much longer search query with many more tokens to test cost calculation accuracy',
        })
        expect(response.status).toBe(200)
        expect(data.data.cost.input).toBe(0.00002084)
        expect(data.data.cost.tokens.prompt).toBe(1042)
        expect(mocks.cost).toHaveBeenCalledWith('text-embedding-3-small', 1042, 0, false)
      })
    })
  })

  describe('Optional Query Search', () => {
    beforeEach(() => {
      mocks.tags.mockResolvedValue(tagDefinitions)
    })

    it('performs tag-only search without a query', async () => {
      const { response, data } = await search({
        knowledgeBaseIds: 'kb-123',
        filters: { category: 'api' },
        topK: 10,
      })
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.results[0].similarity).toBe(1)
      expect(data.data.query).toBe('')
      expect(data.data.cost).toBeUndefined()
      expect(mocks.embedding).not.toHaveBeenCalled()
      expect(mocks.tagSearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: { tag1: 'api' },
      })
    })

    it('performs query + tag combination search', async () => {
      const { response, data } = await search({
        knowledgeBaseIds: 'kb-123',
        query: 'test search',
        filters: { category: 'api' },
        topK: 10,
      })
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.query).toBe('test search')
      expect(data.data.cost).toBeDefined()
      expect(mocks.embedding).toHaveBeenCalled()
      expect(mocks.combinedSearch).toHaveBeenCalledWith({
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: { tag1: 'api' },
        queryVector: JSON.stringify(embedding),
        distanceThreshold: 1,
      })
    })

    it('returns structured unavailability when display-name filters cannot be validated', async () => {
      mocks.tags.mockRejectedValue(new Error('database unavailable'))
      const { response, data } = await search({
        knowledgeBaseIds: 'kb-123',
        filters: { category: 'api' },
      })
      expect(response.status).toBe(503)
      expect(data).toEqual({
        error: 'Tag filters could not be validated because tag definitions are unavailable',
        code: 'TAG_FILTER_DEFINITIONS_UNAVAILABLE',
      })
      expect(mocks.tagSearch).not.toHaveBeenCalled()
      expect(mocks.combinedSearch).not.toHaveBeenCalled()
    })

    it.each([
      ['missing query and filters', { topK: 10 }],
      ['empty query and filters', { topK: 10, query: '', filters: {} }],
      ['empty tag editor result', { topK: 10, query: '' }],
      ['null frontend values', { topK: null, query: null, filters: null }],
    ] as const)('rejects %s', async (_name, body) => {
      const { response, data } = await search({ knowledgeBaseIds: 'kb-123', ...body })
      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Please provide either a search query or tag filters to search your knowledge base',
          }),
        ])
      )
    })

    it('performs query-only search', async () => {
      const { response, data } = await search()
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(2)
      expect(data.data.query).toBe('test search query')
      expect(data.data.cost).toBeDefined()
      expect(mocks.embedding).toHaveBeenCalled()
    })

    it('handles tag-only search with multiple knowledge bases', async () => {
      const { response, data } = await search({
        knowledgeBaseIds: ['kb-123', 'kb-456'],
        filters: { category: 'docs', priority: 'high' },
        topK: 10,
      })
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.knowledgeBaseIds).toEqual(['kb-123', 'kb-456'])
      expect(mocks.embedding).not.toHaveBeenCalled()
    })
  })

  describe('Canonical tool filters and authenticated scope', () => {
    beforeEach(() => {
      mocks.auth.mockResolvedValue({ success: true, userId: 'actor-1' })
      mocks.workflowScope.mockResolvedValue({
        ok: true,
        userId: 'actor-1',
        workspaceId: 'workspace-123',
        workflowId: 'workflow-123',
      })
      mocks.tags.mockResolvedValue(tagDefinitions)
      mocks.tagSearch.mockResolvedValue([])
      mocks.combinedSearch.mockResolvedValue([])
      mocks.vectorSearch.mockResolvedValue([])
    })

    it.each([undefined, 'authentication'])(
      'runs actual tool body through POST with query %s',
      async (query) => {
        const { response } = await search(
          knowledgeSearchTool.request.body!({
            knowledgeBaseId: 'kb-123',
            query,
            tagFilters: JSON.stringify([
              { tagName: 'category', tagValue: 'api' },
              { tagName: 'category', tagValue: 'guide' },
              { tagName: 'priority', tagValue: 'high' },
            ]),
            _context: { workflowId: 'workflow-123' },
          })
        )
        expect(response.status).toBe(200)
        expect(query ? mocks.combinedSearch : mocks.tagSearch).toHaveBeenCalledWith(
          expect.objectContaining({ filters: { tag1: 'api|OR|guide', tag2: 'high' } })
        )
        expect(mocks.access).toHaveBeenCalledWith('kb-123', 'actor-1')
        if (!query) expect(mocks.embedding).not.toHaveBeenCalled()
      }
    )

    it.each([{ missing: 'private' }, { category: '' }, { category: 'api|OR|' }])(
      'rejects invalid filters without broadening the search: %j',
      async (filters) => {
        const { response } = await search({ knowledgeBaseIds: 'kb-123', query: 'query', filters })
        expect(response.status).toBe(400)
        expect(mocks.vectorSearch).not.toHaveBeenCalled()
        expect(mocks.combinedSearch).not.toHaveBeenCalled()
        expect(mocks.embedding).not.toHaveBeenCalled()
      }
    )

    it('rejects the superseded tagFilters body instead of silently stripping it', async () => {
      const { response } = await search({
        knowledgeBaseIds: 'kb-123',
        query: 'query',
        tagFilters: [{ tagName: 'category', value: 'private' }],
      })
      expect(response.status).toBe(400)
      expect(mocks.embedding).not.toHaveBeenCalled()
    })

    it('merges a display name and raw slot referring to the same tag', async () => {
      const { response } = await search({
        knowledgeBaseIds: 'kb-123',
        filters: { category: 'api', tag1: 'guide' },
      })
      expect(response.status).toBe(200)
      expect(mocks.tagSearch).toHaveBeenCalledWith(
        expect.objectContaining({ filters: { tag1: 'api|OR|guide' } })
      )
    })

    it('rejects multi-KB display names with incompatible tag slots', async () => {
      mocks.tags.mockImplementation(async (id) => [
        { tagSlot: id === 'kb-123' ? 'tag1' : 'tag2', displayName: 'category' },
      ])
      const { response } = await search({
        knowledgeBaseIds: ['kb-123', 'kb-456'],
        filters: { category: 'api' },
      })
      expect(response.status).toBe(400)
      expect(mocks.tagSearch).not.toHaveBeenCalled()
    })

    it('does not accept workflowId as authentication', async () => {
      mocks.auth.mockResolvedValue({ success: false })
      const { response } = await search({
        knowledgeBaseIds: 'kb-123',
        query: 'query',
        workflowId: 'workflow-owner',
      })
      expect(response.status).toBe(401)
      expect(mocks.workflowScope).not.toHaveBeenCalled()
      expect(mocks.access).not.toHaveBeenCalled()
    })

    it('rejects unauthorized workflow callers and cross-workspace knowledge bases', async () => {
      mocks.workflowScope.mockResolvedValueOnce({
        ok: false,
        error: 'Workflow access denied',
        status: 403,
      })
      const body = { knowledgeBaseIds: 'kb-123', query: 'query', workflowId: 'workflow-123' }
      expect((await search(body)).response.status).toBe(403)
      mocks.access.mockResolvedValue({
        hasAccess: true,
        knowledgeBase: { id: 'kb-123', workspaceId: 'other-workspace' },
      })
      expect((await search(body)).response.status).toBe(404)
      expect(mocks.embedding).not.toHaveBeenCalled()
    })
  })

  describe('Active document result projection', () => {
    it.each([
      {
        mode: 'vector',
        handler: mocks.vectorSearch,
        query: 'test query',
        filters: undefined,
        id: 'chunk-1',
        documentId: 'doc-active',
        documentName: 'Active Document.pdf',
        content: 'Content from active document',
        tag1: null,
        distance: 0.2,
      },
      {
        mode: 'tags',
        handler: mocks.tagSearch,
        query: undefined,
        filters: { tag1: 'api' },
        id: 'chunk-2',
        documentId: 'doc-active-tagged',
        documentName: 'Active Tagged Document.pdf',
        content: 'Content from active document with tag',
        tag1: 'api',
        distance: 0,
      },
      {
        mode: 'combined',
        handler: mocks.combinedSearch,
        query: 'relevant content',
        filters: { tag1: 'guide' },
        id: 'chunk-3',
        documentId: 'doc-active-combined',
        documentName: 'Active Combined Search.pdf',
        content: 'Relevant content from active document',
        tag1: 'guide',
        distance: 0.15,
      },
    ])('projects active $mode results with document names', async (testCase) => {
      const { handler, documentId, documentName, query, filters, ...result } = testCase
      handler.mockResolvedValue([
        {
          ...result,
          documentId,
          chunkIndex: 0,
          knowledgeBaseId: 'kb-123',
          tag2: null,
          tag3: null,
          tag4: null,
          tag5: null,
          tag6: null,
          tag7: null,
        },
      ])
      mocks.documentNames.mockResolvedValue({ [documentId]: documentName })
      const { response, data } = await search({
        knowledgeBaseIds: ['kb-123'],
        query,
        filters,
        topK: 10,
      })
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.results).toHaveLength(1)
      expect(data.data.results[0].documentId).toBe(documentId)
      expect(data.data.results[0].documentName).toBe(documentName)
      expect(data.data.results[0].metadata).toEqual(result.tag1 ? { tag1: result.tag1 } : {})
      expect(data.data.results[0].similarity).toBe(1 - result.distance)
    })
  })
})
