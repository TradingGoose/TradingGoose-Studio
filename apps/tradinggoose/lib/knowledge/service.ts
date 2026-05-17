import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  permissions,
} from '@tradinggoose/db/schema'
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { checkStorageQuota, incrementStorageUsage } from '@/lib/billing/storage'
import { enqueueDocumentProcessingJobs } from '@/lib/knowledge/documents/service'
import {
  copyKnowledgeDocumentFile,
  deleteKnowledgeDocumentFiles,
} from '@/lib/knowledge/documents/storage'
import type {
  ChunkingConfig,
  CreateKnowledgeBaseData,
  KnowledgeBaseWithCounts,
} from '@/lib/knowledge/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

const logger = createLogger('KnowledgeBaseService')

/**
 * Get knowledge bases that a user can access
 */
export async function getKnowledgeBases(
  userId: string,
  workspaceId: string
): Promise<KnowledgeBaseWithCounts[]> {
  const knowledgeBasesWithCounts = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: knowledgeBase.tokenCount,
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .leftJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, knowledgeBase.workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .where(
      and(
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeBase.workspaceId, workspaceId),
        isNotNull(permissions.userId)
      )
    )
    .groupBy(knowledgeBase.id)
    .orderBy(knowledgeBase.createdAt)

  return knowledgeBasesWithCounts.map((kb) => ({
    ...kb,
    chunkingConfig: kb.chunkingConfig as ChunkingConfig,
    docCount: Number(kb.docCount),
  }))
}

/**
 * Create a new knowledge base
 */
export async function createKnowledgeBase(
  data: CreateKnowledgeBaseData,
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const kbId = randomUUID()
  const now = new Date()

  const hasPermission = await getUserEntityPermissions(data.userId, 'workspace', data.workspaceId)
  if (hasPermission !== 'write' && hasPermission !== 'admin') {
    throw new Error('User does not have permission to create knowledge bases in this workspace')
  }

  const newKnowledgeBase = {
    id: kbId,
    name: data.name,
    description: data.description ?? null,
    workspaceId: data.workspaceId,
    userId: data.userId,
    tokenCount: 0,
    embeddingModel: data.embeddingModel,
    embeddingDimension: data.embeddingDimension,
    chunkingConfig: data.chunkingConfig,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  await db.insert(knowledgeBase).values(newKnowledgeBase)

  logger.info(`[${requestId}] Created knowledge base: ${data.name} (${kbId})`)

  return {
    id: kbId,
    name: data.name,
    description: data.description ?? null,
    tokenCount: 0,
    embeddingModel: data.embeddingModel,
    embeddingDimension: data.embeddingDimension,
    chunkingConfig: data.chunkingConfig,
    createdAt: now,
    updatedAt: now,
    workspaceId: data.workspaceId,
    docCount: 0,
  }
}

export async function copyKnowledgeBaseToWorkspace(
  sourceKnowledgeBaseId: string,
  targetWorkspaceId: string,
  userId: string,
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const hasPermission = await getUserEntityPermissions(userId, 'workspace', targetWorkspaceId)
  if (hasPermission !== 'write' && hasPermission !== 'admin') {
    throw new Error('User does not have permission to create knowledge bases in this workspace')
  }

  const [sourceKnowledgeBase] = await db
    .select()
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, sourceKnowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (!sourceKnowledgeBase) {
    throw new Error(`Knowledge base ${sourceKnowledgeBaseId} not found`)
  }

  const sourceDocuments = await db
    .select()
    .from(document)
    .where(and(eq(document.knowledgeBaseId, sourceKnowledgeBaseId), isNull(document.deletedAt)))

  const totalDocumentSize = sourceDocuments.reduce((sum, doc) => sum + doc.fileSize, 0)
  if (totalDocumentSize > 0) {
    const quotaCheck = await checkStorageQuota(userId, totalDocumentSize, targetWorkspaceId)
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.error || 'Storage limit exceeded')
    }
  }

  const newKnowledgeBaseId = randomUUID()
  const now = new Date()
  const processingJobs: Parameters<typeof enqueueDocumentProcessingJobs>[0] = []
  const copiedDocuments = await Promise.all(
    sourceDocuments.map(async (sourceDocument) => ({
      sourceDocument,
      fileUrl: await copyKnowledgeDocumentFile({
        sourceFileUrl: sourceDocument.fileUrl,
        targetWorkspaceId,
        targetKnowledgeBaseId: newKnowledgeBaseId,
        filename: sourceDocument.filename,
        mimeType: sourceDocument.mimeType,
      }),
    }))
  )

  const copyTransaction = db.transaction(async (tx) => {
    await tx.insert(knowledgeBase).values({
      id: newKnowledgeBaseId,
      userId,
      workspaceId: targetWorkspaceId,
      name: `${sourceKnowledgeBase.name} (Copy)`,
      description: sourceKnowledgeBase.description,
      tokenCount: sourceKnowledgeBase.tokenCount,
      embeddingModel: sourceKnowledgeBase.embeddingModel,
      embeddingDimension: sourceKnowledgeBase.embeddingDimension,
      chunkingConfig: sourceKnowledgeBase.chunkingConfig,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })

    const tagDefinitions = await tx
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, sourceKnowledgeBaseId))

    if (tagDefinitions.length > 0) {
      await tx.insert(knowledgeBaseTagDefinitions).values(
        tagDefinitions.map((definition) => ({
          id: randomUUID(),
          knowledgeBaseId: newKnowledgeBaseId,
          tagSlot: definition.tagSlot,
          displayName: definition.displayName,
          fieldType: definition.fieldType,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }

    const documentIdMap = new Map<string, string>()
    const documentRecords = copiedDocuments.map(({ sourceDocument, fileUrl }) => {
      const newDocumentId = randomUUID()
      const shouldCopyEmbeddings = sourceDocument.processingStatus === 'completed'
      documentIdMap.set(sourceDocument.id, newDocumentId)

      if (!shouldCopyEmbeddings) {
        processingJobs.push({
          knowledgeBaseId: newKnowledgeBaseId,
          documentId: newDocumentId,
          docData: {
            filename: sourceDocument.filename,
            fileUrl,
            fileSize: sourceDocument.fileSize,
            mimeType: sourceDocument.mimeType,
          },
          processingOptions: {
            chunkSize: (sourceKnowledgeBase.chunkingConfig as ChunkingConfig).maxSize,
            minCharactersPerChunk: (sourceKnowledgeBase.chunkingConfig as ChunkingConfig).minSize,
            chunkOverlap: (sourceKnowledgeBase.chunkingConfig as ChunkingConfig).overlap,
          },
          requestId,
        })
      }

      return {
        id: newDocumentId,
        knowledgeBaseId: newKnowledgeBaseId,
        filename: sourceDocument.filename,
        fileUrl,
        fileSize: sourceDocument.fileSize,
        mimeType: sourceDocument.mimeType,
        chunkCount: shouldCopyEmbeddings ? sourceDocument.chunkCount : 0,
        tokenCount: shouldCopyEmbeddings ? sourceDocument.tokenCount : 0,
        characterCount: shouldCopyEmbeddings ? sourceDocument.characterCount : 0,
        processingStatus: shouldCopyEmbeddings ? 'completed' : 'pending',
        processingStartedAt: null,
        processingCompletedAt: shouldCopyEmbeddings ? now : null,
        processingError: null,
        enabled: sourceDocument.enabled,
        deletedAt: null,
        uploadedAt: now,
        tag1: sourceDocument.tag1,
        tag2: sourceDocument.tag2,
        tag3: sourceDocument.tag3,
        tag4: sourceDocument.tag4,
        tag5: sourceDocument.tag5,
        tag6: sourceDocument.tag6,
        tag7: sourceDocument.tag7,
      }
    })

    if (documentRecords.length > 0) {
      await tx.insert(document).values(documentRecords)
    }

    const completedSourceDocumentIds = copiedDocuments
      .filter(({ sourceDocument }) => sourceDocument.processingStatus === 'completed')
      .map(({ sourceDocument }) => sourceDocument.id)

    if (completedSourceDocumentIds.length > 0) {
      const sourceEmbeddings = await tx
        .select()
        .from(embedding)
        .where(inArray(embedding.documentId, completedSourceDocumentIds))

      if (sourceEmbeddings.length > 0) {
        await tx.insert(embedding).values(
          sourceEmbeddings.map((sourceEmbedding) => ({
            id: randomUUID(),
            knowledgeBaseId: newKnowledgeBaseId,
            documentId: documentIdMap.get(sourceEmbedding.documentId)!,
            chunkIndex: sourceEmbedding.chunkIndex,
            chunkHash: sourceEmbedding.chunkHash,
            content: sourceEmbedding.content,
            contentLength: sourceEmbedding.contentLength,
            tokenCount: sourceEmbedding.tokenCount,
            embedding: sourceEmbedding.embedding,
            embeddingModel: sourceEmbedding.embeddingModel,
            startOffset: sourceEmbedding.startOffset,
            endOffset: sourceEmbedding.endOffset,
            tag1: sourceEmbedding.tag1,
            tag2: sourceEmbedding.tag2,
            tag3: sourceEmbedding.tag3,
            tag4: sourceEmbedding.tag4,
            tag5: sourceEmbedding.tag5,
            tag6: sourceEmbedding.tag6,
            tag7: sourceEmbedding.tag7,
            enabled: sourceEmbedding.enabled,
            createdAt: now,
            updatedAt: now,
          }))
        )
      }
    }
  })

  try {
    await copyTransaction
  } catch (error) {
    if (copiedDocuments.length > 0) {
      try {
        await deleteKnowledgeDocumentFiles(copiedDocuments.map(({ fileUrl }) => fileUrl))
      } catch (cleanupError) {
        logger.error(`[${requestId}] Failed to clean up copied knowledge base files:`, cleanupError)
      }
    }
    throw error
  }

  if (totalDocumentSize > 0) {
    try {
      await incrementStorageUsage(userId, totalDocumentSize, targetWorkspaceId)
    } catch (error) {
      logger.error(`[${requestId}] Failed to update copied knowledge base storage usage:`, error)
    }
  }

  if (processingJobs.length > 0) {
    await enqueueDocumentProcessingJobs(processingJobs, requestId)
  }

  logger.info(
    `[${requestId}] Copied knowledge base ${sourceKnowledgeBaseId} to workspace ${targetWorkspaceId} as ${newKnowledgeBaseId}`
  )

  return {
    id: newKnowledgeBaseId,
    name: `${sourceKnowledgeBase.name} (Copy)`,
    description: sourceKnowledgeBase.description,
    tokenCount: sourceKnowledgeBase.tokenCount,
    embeddingModel: sourceKnowledgeBase.embeddingModel,
    embeddingDimension: sourceKnowledgeBase.embeddingDimension,
    chunkingConfig: sourceKnowledgeBase.chunkingConfig as ChunkingConfig,
    createdAt: now,
    updatedAt: now,
    workspaceId: targetWorkspaceId,
    docCount: sourceDocuments.length,
  }
}

/**
 * Update a knowledge base
 */
export async function updateKnowledgeBase(
  knowledgeBaseId: string,
  updates: {
    name?: string
    description?: string
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
  },
  requestId: string
): Promise<KnowledgeBaseWithCounts> {
  const now = new Date()
  const updateData: {
    updatedAt: Date
    name?: string
    description?: string | null
    chunkingConfig?: {
      maxSize: number
      minSize: number
      overlap: number
    }
  } = {
    updatedAt: now,
  }

  if (updates.name !== undefined) updateData.name = updates.name
  if (updates.description !== undefined) updateData.description = updates.description
  if (updates.chunkingConfig !== undefined) {
    updateData.chunkingConfig = updates.chunkingConfig
  }

  await db.update(knowledgeBase).set(updateData).where(eq(knowledgeBase.id, knowledgeBaseId))

  const updatedKb = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: knowledgeBase.tokenCount,
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .groupBy(knowledgeBase.id)
    .limit(1)

  if (updatedKb.length === 0) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found`)
  }

  logger.info(`[${requestId}] Updated knowledge base: ${knowledgeBaseId}`)

  return {
    ...updatedKb[0],
    chunkingConfig: updatedKb[0].chunkingConfig as ChunkingConfig,
    docCount: Number(updatedKb[0].docCount),
  }
}

/**
 * Get a single knowledge base by ID
 */
export async function getKnowledgeBaseById(
  knowledgeBaseId: string
): Promise<KnowledgeBaseWithCounts | null> {
  const result = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      tokenCount: knowledgeBase.tokenCount,
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt,
      workspaceId: knowledgeBase.workspaceId,
      docCount: count(document.id),
    })
    .from(knowledgeBase)
    .leftJoin(
      document,
      and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
    )
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .groupBy(knowledgeBase.id)
    .limit(1)

  if (result.length === 0) {
    return null
  }

  return {
    ...result[0],
    chunkingConfig: result[0].chunkingConfig as ChunkingConfig,
    docCount: Number(result[0].docCount),
  }
}

/**
 * Delete a knowledge base (soft delete)
 */
export async function deleteKnowledgeBase(
  knowledgeBaseId: string,
  requestId: string
): Promise<void> {
  const now = new Date()

  await db
    .update(knowledgeBase)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(knowledgeBase.id, knowledgeBaseId))

  logger.info(`[${requestId}] Soft deleted knowledge base: ${knowledgeBaseId}`)
}
