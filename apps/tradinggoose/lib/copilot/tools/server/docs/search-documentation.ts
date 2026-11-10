import { db } from '@tradinggoose/db'
import { docsEmbeddings } from '@tradinggoose/db/schema'
import { sql } from 'drizzle-orm'
import {
  authorizeNativeConversationScope,
  getNativeFinancialSource,
  NativeTargetError,
  resolveNativePendingTarget,
} from '@/lib/copilot/native/target'
import { ServerToolArgSchemas } from '@/lib/copilot/registry'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import {
  type BaseServerTool,
  hashServerToolReviewBase,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createLogger } from '@/lib/logs/console/logger'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'

interface DocsSearchParams {
  query: string
  topK?: number
  threshold?: number
}

export const searchDocumentationServerTool: BaseServerTool<DocsSearchParams, any> = {
  name: 'search_documentation',
  async execute(params: DocsSearchParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('SearchDocumentationServerTool')
    const { query, topK = 10, threshold } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')
    if (!context?.userId) throw new Error('Authenticated embedding actor is required')
    throwIfServerToolAborted(context)

    const source = getNativeFinancialSource(context)
    if (context.nativeReviewBinding && !source)
      throw new NativeTargetError(
        'Original native documentation financial provenance is missing',
        403
      )
    const verifySource = source
      ? async () => {
          if (
            context.userId !== source.scope.actorUserId ||
            context.signal !== source.signal ||
            !source.signal ||
            source.target.toolName !== 'search_documentation'
          )
            throw new NativeTargetError(
              'Original documentation actor, target or signal changed',
              403
            )
          source.signal.throwIfAborted()
          const original = ServerToolArgSchemas.search_documentation.parse(
            JSON.parse(source.originalArgsJson)
          )
          if (stableStringifyJsonValue(original) !== stableStringifyJsonValue(params))
            throw new NativeTargetError('Original documentation arguments changed', 403)
          const scope = await authorizeNativeConversationScope(
            source.scope.actorUserId,
            source.scope.workspaceId
          )
          const pending = await resolveNativePendingTarget(
            scope,
            source.target,
            'result',
            source.signal
          )
          const current = getNativeFinancialSource(pending)
          if (
            !current ||
            current.pendingJson !== source.pendingJson ||
            current.acceptanceJson !== source.acceptanceJson
          )
            throw new NativeTargetError('Original native documentation target changed', 409)
          source.signal.throwIfAborted()
        }
      : undefined
    // The marker only requires an authentic source; it never selects a financial actor/root.
    if (verifySource) await verifySource()
    const embeddingScope = source
      ? {
          actorUserId: source.binding.actorUserId,
          workspaceId: source.binding.workspaceId,
          workflowId: source.binding.workflowId,
          signal: source.signal,
          runId: `embedding-copilot-docs:${hashServerToolReviewBase({
            purpose: 'embedding',
            scope: source.scope,
            pending: source.pendingJson,
          })}`,
          expectedNamespace: source.binding.namespace,
          verifySource,
        }
      : { actorUserId: context.userId, workspaceId: context.workspaceId, signal: context.signal }

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

    const { generateSearchEmbedding } = await import('@/lib/embeddings/utils')
    let embeddingResult: Awaited<ReturnType<typeof generateSearchEmbedding>>
    let queryEmbedding: number[]
    try {
      embeddingResult = await generateSearchEmbedding(query, embeddingScope)
      queryEmbedding = embeddingResult.embedding
    } catch (error) {
      const preserveKnownEmbedding = (failure: Error) => {
        // Copy only safe string-key accounting, never reassign a readonly private Symbol.
        Object.assign(failure, Object.fromEntries(Object.entries(getFailureAccounting(error))))
        const facts = getInferenceFacts(error)
        if (facts && !getInferenceFacts(failure)) withInferenceFacts(failure, facts)
        if (error && typeof error === 'object' && 'completedEmbeddings' in error)
          Object.assign(failure, { completedEmbeddings: error.completedEmbeddings })
        return failure
      }
      if (
        error instanceof Error &&
        /API key.*(?:not found|required)|embedding provider.*configured/i.test(error.message)
      ) {
        throw preserveKnownEmbedding(
          new StructuredServerToolError({
            status: 503,
            body: {
              code: 'search_documentation_unavailable',
              error:
                'Documentation search is unavailable because no embedding provider is configured.',
              hint: 'Configure credentials for the listed embedding model to enable documentation search.',
              retryable: false,
            },
          })
        )
      }

      const status =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number(error.statusCode)
          : undefined
      if (status && Number.isFinite(status)) {
        throw preserveKnownEmbedding(
          new StructuredServerToolError({
            status: status === 429 || status >= 500 ? 503 : 502,
            body: {
              code: 'search_documentation_backend_failed',
              error: 'Documentation search failed while generating the query embedding.',
              hint: 'Check the configured Mastra embedding connection and retry the search.',
              retryable: status === 429 || status >= 500,
            },
          })
        )
      }

      throw error
    }

    try {
      throwIfServerToolAborted(context)
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
      const result = {
        results: documentationResults,
        query,
        totalResults: documentationResults.length,
        embeddingUsage: {
          model: embeddingResult.model,
          tokens: embeddingResult.tokens,
          usage: embeddingResult.usage,
          cost: embeddingResult.cost,
        },
      }
      const facts = getInferenceFacts(embeddingResult)
      return facts
        ? withInferenceFacts(result, {
            ...facts,
            generatedFields: [...new Set([...facts.generatedFields, 'embeddingUsage'])],
          })
        : result
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (getInferenceFacts(failure)) throw failure
      const { usage, model, tokens, cost } = embeddingResult
      Object.assign(failure, {
        model,
        tokens,
        cost,
        embeddingUsage: usage,
        completedEmbeddings: [embeddingResult.embedding],
      })
      const facts = getInferenceFacts(embeddingResult)
      if (facts)
        withInferenceFacts(failure, {
          ...facts,
          generatedFields: [...new Set([...facts.generatedFields, 'embeddingUsage'])],
        })
      throw failure
    }
  },
}
