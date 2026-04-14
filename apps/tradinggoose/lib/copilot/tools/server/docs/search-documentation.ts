import { db } from '@tradinggoose/db'
import { docsEmbeddings } from '@tradinggoose/db/schema'
import { sql } from 'drizzle-orm'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface DocsSearchParams {
  query: string
  topK?: number
  threshold?: number
}

const EMBEDDING_CONFIG_MISSING_ERROR =
  'Either the OpenAI default API key or Azure OpenAI service config must be configured'

export const searchDocumentationServerTool: BaseServerTool<DocsSearchParams, any> = {
  name: 'search_documentation',
  async execute(params: DocsSearchParams): Promise<any> {
    const logger = createLogger('SearchDocumentationServerTool')
    const { query, topK = 10, threshold } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')

    logger.info('Executing docs search', { query, topK })

    const { getCopilotConfig } = await import('@/lib/copilot/config')
    const config = getCopilotConfig()
    const similarityThreshold = threshold ?? config.rag.similarityThreshold

    const indexedChunks = await db
      .select({ chunkId: docsEmbeddings.chunkId })
      .from(docsEmbeddings)
      .limit(1)

    if (indexedChunks.length === 0) {
      logger.info('Skipping docs search because no documentation embeddings are indexed')
      return { results: [], query, totalResults: 0 }
    }

    const { EmbeddingAPIError, generateSearchEmbedding } = await import('@/lib/embeddings/utils')
    let queryEmbedding: number[]
    try {
      queryEmbedding = await generateSearchEmbedding(query)
    } catch (error) {
      if (error instanceof Error && error.message === EMBEDDING_CONFIG_MISSING_ERROR) {
        throw new StructuredServerToolError({
          status: 503,
          body: {
            code: 'search_documentation_unavailable',
            error:
              'Documentation search is unavailable because no embedding provider is configured.',
            hint:
              'Configure the OpenAI default API key or Azure OpenAI embedding service to enable documentation search.',
            retryable: false,
          },
        })
      }

      if (error instanceof EmbeddingAPIError) {
        throw new StructuredServerToolError({
          status: error.status === 429 || error.status >= 500 ? 503 : 502,
          body: {
            code: 'search_documentation_backend_failed',
            error: 'Documentation search failed while generating the query embedding.',
            hint:
              'Check the configured OpenAI or Azure OpenAI embedding service and retry the search.',
            retryable: error.status === 429 || error.status >= 500,
          },
        })
      }

      throw error
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      return { results: [], query, totalResults: 0 }
    }

    const results = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(docsEmbeddings)
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(topK)

    const filteredResults = results.filter((r) => r.similarity >= similarityThreshold)
    const documentationResults = filteredResults.map((r, idx) => ({
      id: idx + 1,
      title: String(r.headerText || 'Untitled Section'),
      url: String(r.sourceLink || '#'),
      content: String(r.chunkText || ''),
      similarity: r.similarity,
    }))

    logger.info('Docs search complete', { count: documentationResults.length })
    return { results: documentationResults, query, totalResults: documentationResults.length }
  },
}
