import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const selectMock = vi.fn()
const createLoggerMock = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
const getCopilotConfigMock = vi.fn(() => ({
  rag: {
    similarityThreshold: 0.3,
  },
}))
const generateSearchEmbeddingMock = vi.fn()

class MockEmbeddingAPIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
  }
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: selectMock,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  docsEmbeddings: {
    chunkId: 'docs_embeddings.chunk_id',
    chunkText: 'docs_embeddings.chunk_text',
    sourceDocument: 'docs_embeddings.source_document',
    sourceLink: 'docs_embeddings.source_link',
    headerText: 'docs_embeddings.header_text',
    headerLevel: 'docs_embeddings.header_level',
    embedding: 'docs_embeddings.embedding',
  },
}))

vi.mock('drizzle-orm', () => ({
  sql: (() => 'sql') as unknown,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: createLoggerMock,
}))

vi.mock('@/lib/copilot/config', () => ({
  getCopilotConfig: getCopilotConfigMock,
}))

vi.mock('@/lib/embeddings/utils', () => ({
  EmbeddingAPIError: MockEmbeddingAPIError,
  generateSearchEmbedding: generateSearchEmbeddingMock,
}))

let searchDocumentationServerTool: typeof import('./search-documentation').searchDocumentationServerTool

beforeAll(async () => {
  ;({ searchDocumentationServerTool } = await import('./search-documentation'))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('searchDocumentationServerTool', () => {
  it('returns an empty result without generating embeddings when no docs are indexed', async () => {
    const limitMock = vi.fn().mockResolvedValue([])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })

    const result = await searchDocumentationServerTool.execute({ query: 'workflow edge docs' })

    expect(result).toEqual({
      results: [],
      query: 'workflow edge docs',
      totalResults: 0,
    })
    expect(generateSearchEmbeddingMock).not.toHaveBeenCalled()
  })

  it('returns a structured unavailable error when docs exist but embeddings are not configured', async () => {
    const limitMock = vi.fn().mockResolvedValue([{ chunkId: 'chunk-1' }])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })
    generateSearchEmbeddingMock.mockRejectedValue(
      new Error('Either the OpenAI default API key or Azure OpenAI service config must be configured')
    )

    await expect(
      searchDocumentationServerTool.execute({ query: 'workflow edge docs' })
    ).rejects.toMatchObject({
      name: 'StructuredServerToolError',
      status: 503,
      code: 'search_documentation_unavailable',
      message: 'Documentation search is unavailable because no embedding provider is configured.',
      retryable: false,
    })
  })

  it('returns a structured backend error when embedding generation fails upstream', async () => {
    const limitMock = vi.fn().mockResolvedValue([{ chunkId: 'chunk-1' }])
    const fromMock = vi.fn(() => ({
      limit: limitMock,
    }))
    selectMock.mockReturnValue({
      from: fromMock,
    })
    generateSearchEmbeddingMock.mockRejectedValue(
      new MockEmbeddingAPIError('Embedding API failed: 503 Service Unavailable', 503)
    )

    await expect(
      searchDocumentationServerTool.execute({ query: 'workflow edge docs' })
    ).rejects.toMatchObject({
      name: 'StructuredServerToolError',
      status: 503,
      code: 'search_documentation_backend_failed',
      message: 'Documentation search failed while generating the query embedding.',
      retryable: true,
    })
  })
})
