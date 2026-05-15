import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { TAG_SLOTS } from '@/lib/knowledge/consts'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserId } from '@/lib/oauth/tokens'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { generateRequestId } from '@/lib/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { calculateCost } from '@/providers/ai/utils'
import {
  generateSearchEmbedding,
  getDocumentNamesByIds,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from './utils'

const logger = createLogger('VectorSearchAPI')

const VectorSearchSchema = z
  .object({
    knowledgeBaseIds: z.union([
      z.string().min(1, 'Knowledge base ID is required'),
      z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
    ]),
    query: z
      .string()
      .optional()
      .nullable()
      .transform((val) => val || undefined),
    topK: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .nullable()
      .default(10)
      .transform((val) => val ?? 10),
    filters: z
      .record(z.string())
      .optional()
      .nullable()
      .transform((val) => val || undefined), // Allow dynamic filter keys (display names)
  })
  .refine(
    (data) => {
      // Ensure at least query or filters are provided
      const hasQuery = data.query && data.query.trim().length > 0
      const hasFilters = data.filters && Object.keys(data.filters).length > 0
      return hasQuery || hasFilters
    },
    {
      message: 'Please provide either a search query or tag filters to search your knowledge base',
    }
  )

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { workflowId, ...searchParams } = body

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      const errorMessage = workflowId ? 'Workflow not found' : 'Unauthorized'
      const statusCode = workflowId ? 404 : 401
      return NextResponse.json({ error: errorMessage }, { status: statusCode })
    }

    try {
      const validatedData = VectorSearchSchema.parse(searchParams)

      const knowledgeBaseIds = Array.isArray(validatedData.knowledgeBaseIds)
        ? validatedData.knowledgeBaseIds
        : [validatedData.knowledgeBaseIds]

      // Check access permissions in parallel for performance
      const accessChecks = await Promise.all(
        knowledgeBaseIds.map((kbId) => checkKnowledgeBaseAccess(kbId, userId))
      )
      const accessibleKnowledgeBases = accessChecks.flatMap((check) =>
        check.hasAccess ? [check.knowledgeBase] : []
      )
      const accessibleKbIds = accessibleKnowledgeBases.map((kb) => kb.id)

      // Map display names to tag slots for filtering
      const mappedFilters: Record<string, string> = {}
      if (validatedData.filters && accessibleKbIds.length > 0) {
        try {
          // Fetch tag definitions for the first accessible KB (since we're using single KB now)
          const kbId = accessibleKbIds[0]
          const tagDefs = await getDocumentTagDefinitions(kbId)

          logger.debug(`[${requestId}] Found tag definitions:`, tagDefs)
          logger.debug(`[${requestId}] Original filters:`, validatedData.filters)

          // Create mapping from display name to tag slot
          const displayNameToSlot: Record<string, string> = {}
          tagDefs.forEach((def) => {
            displayNameToSlot[def.displayName] = def.tagSlot
          })

          // Map the filters and handle OR logic
          Object.entries(validatedData.filters).forEach(([key, value]) => {
            if (value) {
              const tagSlot = displayNameToSlot[key] || key

              // Check if this is an OR filter (contains |OR| separator)
              if (value.includes('|OR|')) {
                logger.debug(
                  `[${requestId}] OR filter detected: "${key}" -> "${tagSlot}" = "${value}"`
                )
              }

              mappedFilters[tagSlot] = value
              logger.debug(`[${requestId}] Mapped filter: "${key}" -> "${tagSlot}" = "${value}"`)
            }
          })

          logger.debug(`[${requestId}] Final mapped filters:`, mappedFilters)
        } catch (error) {
          logger.error(`[${requestId}] Filter mapping error:`, error)
          return NextResponse.json(
            {
              error: 'Tag filters could not be validated because tag definitions are unavailable',
              code: 'TAG_FILTER_DEFINITIONS_UNAVAILABLE',
            },
            { status: 503 }
          )
        }
      }

      if (accessibleKbIds.length === 0) {
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      // Generate query embedding only if query is provided
      const hasQuery = validatedData.query && validatedData.query.trim().length > 0
      const embeddingModels = Array.from(
        new Set(accessibleKnowledgeBases.map((kb) => kb.embeddingModel))
      )

      if (hasQuery && embeddingModels.length > 1) {
        return NextResponse.json(
          {
            error:
              'Vector search cannot query knowledge bases with different embedding models in one request',
          },
          { status: 400 }
        )
      }

      const queryEmbeddingModel = embeddingModels[0]
      if (hasQuery && !queryEmbeddingModel) {
        return NextResponse.json(
          { error: 'Knowledge base embedding model is missing' },
          { status: 500 }
        )
      }

      // Start embedding generation early and await when needed
      const queryEmbeddingPromise = hasQuery
        ? generateSearchEmbedding(validatedData.query!, queryEmbeddingModel)
        : Promise.resolve(null)

      // Check if any requested knowledge bases were not accessible
      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

      if (inaccessibleKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      let results: SearchResult[]

      const hasFilters = mappedFilters && Object.keys(mappedFilters).length > 0

      if (!hasQuery && hasFilters) {
        // Tag-only search without vector similarity
        logger.debug(`[${requestId}] Executing tag-only search with filters:`, mappedFilters)
        results = await handleTagOnlySearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          filters: mappedFilters,
        })
      } else if (hasQuery && hasFilters) {
        // Tag + Vector search
        logger.debug(`[${requestId}] Executing tag + vector search with filters:`, mappedFilters)
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(await queryEmbeddingPromise)

        results = await handleTagAndVectorSearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          filters: mappedFilters,
          queryVector,
          distanceThreshold: strategy.distanceThreshold,
        })
      } else if (hasQuery && !hasFilters) {
        // Vector-only search
        logger.debug(`[${requestId}] Executing vector-only search`)
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(await queryEmbeddingPromise)

        results = await handleVectorOnlySearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          queryVector,
          distanceThreshold: strategy.distanceThreshold,
        })
      } else {
        // This should never happen due to schema validation, but just in case
        return NextResponse.json(
          {
            error:
              'Please provide either a search query or tag filters to search your knowledge base',
          },
          { status: 400 }
        )
      }

      let costInfo = null
      if (hasQuery) {
        const tokenCount = estimateTokenCount(validatedData.query!, 'openai')
        const cost = calculateCost(queryEmbeddingModel, tokenCount.count, 0, false)
        costInfo = { cost, tokenCount }
      }

      // Fetch tag definitions for display name mapping (reuse the same fetch from filtering)
      const tagDefsResults = await Promise.all(
        accessibleKbIds.map(async (kbId) => {
          try {
            const tagDefs = await getDocumentTagDefinitions(kbId)
            const map: Record<string, string> = {}
            tagDefs.forEach((def) => {
              map[def.tagSlot] = def.displayName
            })
            return { kbId, map }
          } catch (error) {
            logger.warn(
              `[${requestId}] Failed to fetch tag definitions for display mapping:`,
              error
            )
            return { kbId, map: {} as Record<string, string> }
          }
        })
      )
      const tagDefinitionsMap: Record<string, Record<string, string>> = {}
      tagDefsResults.forEach(({ kbId, map }) => {
        tagDefinitionsMap[kbId] = map
      })

      // Fetch document names for the results
      const documentIds = results.map((result) => result.documentId)
      const documentNameMap = await getDocumentNamesByIds(documentIds)

      return NextResponse.json({
        success: true,
        data: {
          results: results.map((result) => {
            const kbTagMap = tagDefinitionsMap[result.knowledgeBaseId] || {}
            logger.debug(
              `[${requestId}] Result KB: ${result.knowledgeBaseId}, available mappings:`,
              kbTagMap
            )

            // Create tags object with display names
            const tags: Record<string, any> = {}

            TAG_SLOTS.forEach((slot) => {
              const tagValue = (result as any)[slot]
              if (tagValue) {
                const displayName = kbTagMap[slot] || slot
                logger.debug(
                  `[${requestId}] Mapping ${slot}="${tagValue}" -> "${displayName}"="${tagValue}"`
                )
                tags[displayName] = tagValue
              }
            })

            return {
              documentId: result.documentId,
              documentName: documentNameMap[result.documentId] || undefined,
              content: result.content,
              chunkIndex: result.chunkIndex,
              metadata: tags, // Clean display name mapped tags
              similarity: hasQuery ? 1 - result.distance : 1, // Perfect similarity for tag-only searches
            }
          }),
          query: validatedData.query || '',
          knowledgeBaseIds: accessibleKbIds,
          knowledgeBaseId: accessibleKbIds[0],
          topK: validatedData.topK,
          totalResults: results.length,
          ...(costInfo
            ? {
                cost: {
                  input: costInfo.cost.input,
                  output: costInfo.cost.output,
                  total: costInfo.cost.total,
                  tokens: {
                    prompt: costInfo.tokenCount.count,
                    completion: 0,
                    total: costInfo.tokenCount.count,
                  },
                  model: queryEmbeddingModel,
                  pricing: costInfo.cost.pricing,
                },
              }
            : {}),
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to perform vector search',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
