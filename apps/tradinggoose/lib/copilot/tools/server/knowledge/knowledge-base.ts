import { ENTITY_KIND_KNOWLEDGE_BASE } from '@/lib/copilot/review-sessions/types'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { generateSearchEmbedding } from '@/lib/embeddings/utils'
import { createKnowledgeBase, getKnowledgeBaseById } from '@/lib/knowledge/service'
import type { ChunkingConfig, KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { createLogger } from '@/lib/logs/console/logger'
import { savedEntityRowToContent } from '@/lib/yjs/entity-state'
import { getQueryStrategy, handleVectorOnlySearch } from '@/app/api/knowledge/search/utils'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateContext,
  type EntityCreateResult,
  type EntityDocumentArgs,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeRenameEntityMutation,
  executeUpdateEntityDocumentMutation,
  type RenameEntityArgs,
  readSavedEntityDocument,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from '../entities/shared'

const logger = createLogger('KnowledgeBaseServerTools')

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  return value.toISOString()
}

function buildKnowledgeBaseDocumentEnvelope(
  kb: KnowledgeBaseWithCounts,
  fields: Record<string, unknown> = savedEntityRowToContent(ENTITY_KIND_KNOWLEDGE_BASE, kb)
) {
  return {
    ...buildDocumentEnvelope(ENTITY_KIND_KNOWLEDGE_BASE, kb.id, kb.name, fields),
    workspaceId: kb.workspaceId,
    docCount: kb.docCount,
    tokenCount: kb.tokenCount,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    createdAt: toIsoString(kb.createdAt),
    updatedAt: toIsoString(kb.updatedAt),
  }
}

async function createKnowledgeBaseEntity(
  name: string,
  fields: Record<string, unknown>,
  { userId, workspaceId }: EntityCreateContext
): Promise<EntityCreateResult> {
  const created = await createKnowledgeBase(
    {
      name,
      description: String(fields.description ?? ''),
      workspaceId,
      userId,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
      chunkingConfig: fields.chunkingConfig as ChunkingConfig,
    },
    crypto.randomUUID().slice(0, 8)
  )

  return {
    entityId: created.id,
    entityName: created.name,
    fields: savedEntityRowToContent(ENTITY_KIND_KNOWLEDGE_BASE, created),
  }
}

async function readAccessibleKnowledgeBase(entityId: string, context?: ServerToolExecutionContext) {
  await verifySavedEntityContext(context, ENTITY_KIND_KNOWLEDGE_BASE, entityId, 'read')
  const kb = await getKnowledgeBaseById(entityId)
  if (!kb) {
    throw new Error('Knowledge base not found')
  }
  return kb
}

export const listKnowledgeBasesServerTool: BaseServerTool<{ workspaceId: string }> = {
  name: 'list_knowledge_bases',
  async execute(args, context) {
    const scopedContext = withWorkspaceArgContext(context, args)
    const { workspaceId } = await verifyWorkspaceContext(scopedContext, 'read')
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_KNOWLEDGE_BASE, workspaceId)

    return {
      entityKind: ENTITY_KIND_KNOWLEDGE_BASE,
      entities,
      count: entities.length,
    }
  },
}

export const readKnowledgeBaseServerTool: EntityServerTool = {
  name: 'read_knowledge_base',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_knowledge_base')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_KNOWLEDGE_BASE,
      entityId,
      'read'
    )
    const [kb, document] = await Promise.all([
      getKnowledgeBaseById(entityId),
      readSavedEntityDocument(ENTITY_KIND_KNOWLEDGE_BASE, entityId, workspaceId),
    ])
    if (!kb) {
      throw new Error('Knowledge base not found')
    }

    return buildKnowledgeBaseDocumentEnvelope(kb, document.fields)
  },
}

export const createKnowledgeBaseServerTool: EntityServerTool = {
  name: 'create_knowledge_base',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_KNOWLEDGE_BASE,
      args,
      context,
      createKnowledgeBaseEntity
    )
  },
}

export const editKnowledgeBaseServerTool: EntityServerTool<EntityDocumentArgs> = {
  name: 'edit_knowledge_base',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_KNOWLEDGE_BASE,
      'edit_knowledge_base',
      args,
      context
    )
  },
}

export const renameKnowledgeBaseServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_knowledge_base',
  execute(args, context) {
    return executeRenameEntityMutation(
      ENTITY_KIND_KNOWLEDGE_BASE,
      'rename_knowledge_base',
      args,
      context
    )
  },
}

export const queryKnowledgeBaseServerTool: BaseServerTool<{
  entityId: string
  query: string
  topK?: number
}> = {
  name: 'query_knowledge_base',
  async execute(args, context) {
    const kb = await readAccessibleKnowledgeBase(args.entityId, context)
    const topK = args.topK || 5

    const queryEmbedding = await generateSearchEmbedding(args.query, kb.embeddingModel)
    const queryVector = JSON.stringify(queryEmbedding)
    const strategy = getQueryStrategy(1, topK)
    const results = await handleVectorOnlySearch({
      knowledgeBaseIds: [args.entityId],
      topK,
      queryVector,
      distanceThreshold: strategy.distanceThreshold,
    })

    logger.info('Knowledge base queried via copilot', {
      knowledgeBaseId: args.entityId,
      resultCount: results.length,
    })

    return {
      entityKind: ENTITY_KIND_KNOWLEDGE_BASE,
      entityId: args.entityId,
      entityName: kb.name,
      query: args.query,
      topK,
      totalResults: results.length,
      results: results.map((result) => ({
        documentId: result.documentId,
        content: result.content,
        chunkIndex: result.chunkIndex,
        similarity: 1 - result.distance,
      })),
    }
  },
}
