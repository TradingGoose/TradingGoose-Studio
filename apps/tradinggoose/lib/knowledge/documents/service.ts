import crypto, { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  pendingExecution,
} from '@tradinggoose/db/schema'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { type EmbeddingScope, generateEmbeddings } from '@/lib/embeddings/utils'
import { env } from '@/lib/env'
import { enqueuePendingExecution } from '@/lib/execution/pending-execution'
import { getSlotsForFieldType, type TAG_SLOT_CONFIG } from '@/lib/knowledge/consts'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import {
  assertKnowledgeDocumentSource,
  deleteKnowledgeDocumentFiles,
  type KnowledgeDocumentFileCleanup,
} from '@/lib/knowledge/documents/storage'
import { getNextAvailableSlot } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { PrivateSourceAccessError } from '@/lib/uploads/source-read-boundary'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import type { DocumentProcessingPayload } from '@/background/knowledge-processing'
import type { DocumentSortField, SortOrder } from './types'

const logger = createLogger('DocumentService')

const TIMEOUTS = {
  OVERALL_PROCESSING: (env.KB_CONFIG_MAX_DURATION || 600) * 1000, // Default 10 minutes for KB document processing
} as const

// Configuration for handling large documents
const LARGE_DOC_CONFIG = {
  MAX_CHUNKS_PER_BATCH: 500, // Insert embeddings in batches of 500
  MAX_EMBEDDING_BATCH: 500, // Generate embeddings in batches of 500
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB max file size
  MAX_CHUNKS_PER_DOCUMENT: 100000, // Maximum chunks allowed per document
}

type DocumentProcessingRequestPayload = Omit<DocumentProcessingPayload, 'userId' | 'workspaceId'>
type DocumentDeletionTarget = {
  id: string
  knowledgeBaseId: string
  fileUrl: string
  fileSize: number
}

function documentSourceWhere(
  knowledgeBaseId: string,
  documentId: string,
  docData: DocumentProcessingPayload['docData']
) {
  return and(
    eq(document.id, documentId),
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.fileUrl, docData.fileUrl),
    eq(document.filename, docData.filename),
    eq(document.mimeType, docData.mimeType),
    eq(document.fileSize, docData.fileSize),
    isNull(document.deletedAt)
  )
}

async function authorizeDocumentProcessingSource(
  knowledgeBaseId: string,
  documentId: string,
  docData: DocumentProcessingPayload['docData'],
  scope: EmbeddingScope
) {
  assertKnowledgeDocumentSource(docData.fileUrl, docData.filename, {
    workspaceId: scope.workspaceId ?? '',
    knowledgeBaseId,
    filename: docData.filename,
  })
  if (!scope.actorUserId?.trim()) throw new PrivateSourceAccessError()
  const access = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, scope.actorUserId)
  if (
    !access.hasAccess ||
    !access.knowledgeBase ||
    access.knowledgeBase.workspaceId !== scope.workspaceId
  )
    throw new PrivateSourceAccessError()
  const [currentDocument] = await db
    .select({ id: document.id })
    .from(document)
    .where(documentSourceWhere(knowledgeBaseId, documentId, docData))
    .limit(1)
  if (!currentDocument) throw new PrivateSourceAccessError()
  return access.knowledgeBase
}

export async function markDocumentProcessingFailed(
  knowledgeBaseId: string,
  documentId: string,
  docData: DocumentProcessingPayload['docData'],
  scope: EmbeddingScope,
  errorMessage: string
) {
  await authorizeDocumentProcessingSource(knowledgeBaseId, documentId, docData, scope)
  await db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({
        processingStatus: 'failed',
        processingStartedAt: null,
        processingCompletedAt: new Date(),
        processingError: errorMessage,
      })
      .where(
        and(
          documentSourceWhere(knowledgeBaseId, documentId, docData),
          inArray(document.processingStatus, ['pending', 'processing'])
        )
      )
  })
}

async function deleteQueuedDocumentExecutions(documentIds: string[]) {
  await Promise.all(
    documentIds.map((documentId) =>
      db
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.executionType, 'document'),
            sql<boolean>`${pendingExecution.id} like ${`document_processing:${documentId}:%`}`
          )
        )
    )
  )
}

async function getUnreferencedDocumentFileUrls(targets: DocumentDeletionTarget[]) {
  const fileUrls = [...new Set(targets.map((target) => target.fileUrl))]

  if (fileUrls.length === 0) {
    return []
  }

  const activeReferences = await db
    .select({ fileUrl: document.fileUrl })
    .from(document)
    .where(and(inArray(document.fileUrl, fileUrls), isNull(document.deletedAt)))

  const stillReferenced = new Set(activeReferences.map((reference) => reference.fileUrl))
  return fileUrls.filter((fileUrl) => !stillReferenced.has(fileUrl))
}

async function decrementStorageUsageForDeletedDocuments(
  targets: DocumentDeletionTarget[],
  requestId: string
) {
  const sizesByKnowledgeBaseId = new Map<string, number>()

  for (const target of targets) {
    sizesByKnowledgeBaseId.set(
      target.knowledgeBaseId,
      (sizesByKnowledgeBaseId.get(target.knowledgeBaseId) ?? 0) + target.fileSize
    )
  }

  for (const [knowledgeBaseId, totalSize] of sizesByKnowledgeBaseId) {
    if (totalSize <= 0) continue

    const [kb] = await db
      .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
      .limit(1)

    if (!kb) continue

    try {
      await decrementStorageUsage(kb.userId, totalSize, kb.workspaceId)
      logger.info(`[${requestId}] Updated knowledge base owner storage usage for -${totalSize}`)
    } catch (error) {
      logger.error(`[${requestId}] Failed to update knowledge base owner storage usage:`, error)
    }
  }
}

async function deleteDocumentTargets(targets: DocumentDeletionTarget[], requestId: string) {
  const targetIds = targets.map((target) => target.id)
  const deletedAt = new Date()

  const result = await db.transaction(async (tx) => {
    await tx.delete(embedding).where(inArray(embedding.documentId, targetIds))

    return tx
      .delete(document)
      .where(and(inArray(document.id, targetIds), isNull(document.deletedAt)))
      .returning({ id: document.id })
  })

  const deletedIds = new Set(result.map((row) => row.id))
  const deletedTargets = targets.filter((target) => deletedIds.has(target.id))
  const fileUrlsToDelete = await getUnreferencedDocumentFileUrls(deletedTargets)
  const storageCleanup = await deleteKnowledgeDocumentFiles(fileUrlsToDelete)
  const storageUsageTargets = storageCleanup.deleted.flatMap((fileUrl) => {
    const target = deletedTargets.find((target) => target.fileUrl === fileUrl)
    return target ? [target] : []
  })

  await deleteQueuedDocumentExecutions([...deletedIds])
  await decrementStorageUsageForDeletedDocuments(storageUsageTargets, requestId)

  return { documents: result.map((row) => ({ ...row, deletedAt })), storageCleanup }
}

/**
 * Create a timeout wrapper for async operations
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
  abort: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort()
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export interface DocumentData {
  documentId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  uploadedAt?: Date
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
}

export interface ProcessingOptions {
  chunkSize: number
  minCharactersPerChunk: number
  chunkOverlap: number
}

export interface DocumentTagData {
  tagName: string
  fieldType: string
  value: string
}

/**
 * Process structured document tags and create tag definitions
 */
export async function processDocumentTags(
  knowledgeBaseId: string,
  tagData: DocumentTagData[],
  requestId: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}

  const textSlots = getSlotsForFieldType('text')
  textSlots.forEach((slot) => {
    result[slot] = null
  })

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  try {
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))
    const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot as string, def]))

    for (const tag of tagData) {
      if (!tag.tagName?.trim() || !tag.value?.trim()) continue

      const tagName = tag.tagName.trim()
      const fieldType = tag.fieldType
      const value = tag.value.trim()

      let targetSlot: string | null = null

      // Check if tag definition already exists
      const existingDef = existingByName.get(tagName)
      if (existingDef) {
        targetSlot = existingDef.tagSlot
      } else {
        // Find next available slot using the tags service function
        targetSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)

        // Create new tag definition if we have a slot
        if (targetSlot) {
          const newDefinition = {
            id: randomUUID(),
            knowledgeBaseId,
            tagSlot: targetSlot as (typeof TAG_SLOT_CONFIG.text.slots)[number],
            displayName: tagName,
            fieldType,
            createdAt: new Date(),
            updatedAt: new Date(),
          }

          await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)
          existingBySlot.set(targetSlot, newDefinition)

          logger.info(`[${requestId}] Created tag definition: ${tagName} -> ${targetSlot}`)
        }
      }

      // Assign value to the slot
      if (targetSlot) {
        result[targetSlot] = value
      }
    }

    return result
  } catch (error) {
    logger.error(`[${requestId}] Error processing document tags:`, error)
    return result
  }
}

/**
 * Process a document asynchronously with full error handling
 */
export async function processDocumentAsync(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  processingOptions: {
    chunkSize: number
    minCharactersPerChunk: number
    chunkOverlap: number
  },
  scope: EmbeddingScope
): Promise<void> {
  const startTime = Date.now()
  const controller = new AbortController()
  const signal = scope.signal
    ? AbortSignal.any([scope.signal, controller.signal])
    : controller.signal
  let completedPrompt: number | undefined
  let completedBatches = 0
  let awaitingEmbedding = false
  let authorized = false
  const sourceWhere = () => documentSourceWhere(knowledgeBaseId, documentId, docData)
  const reauthorize = async (checkCancellation = true) => {
    if (checkCancellation) signal.throwIfAborted()
    const current = await authorizeDocumentProcessingSource(
      knowledgeBaseId,
      documentId,
      docData,
      scope
    )
    if (checkCancellation) signal.throwIfAborted()
    return current
  }
  try {
    const knowledgeBaseState = await reauthorize()
    authorized = true

    const kbEmbeddingModel = knowledgeBaseState.embeddingModel

    await prepareDocumentForProcessing(documentId, sourceWhere())

    logger.info(`[${documentId}] Starting document processing: ${docData.filename}`)

    await withTimeout(
      (async () => {
        const processed = await processDocument(
          docData.fileUrl,
          docData.filename,
          docData.mimeType,
          {
            workspaceId: knowledgeBaseState.workspaceId,
            knowledgeBaseId,
            filename: docData.filename,
            reauthorize: async () => {
              await reauthorize()
            },
            signal,
          },
          processingOptions.chunkSize,
          processingOptions.chunkOverlap,
          processingOptions.minCharactersPerChunk
        )

        if (processed.chunks.length > LARGE_DOC_CONFIG.MAX_CHUNKS_PER_DOCUMENT) {
          throw new Error(
            `Document has ${processed.chunks.length.toLocaleString()} chunks, exceeding maximum of ${LARGE_DOC_CONFIG.MAX_CHUNKS_PER_DOCUMENT.toLocaleString()}. ` +
              `This document is unusually large and may need to be split into multiple files or preprocessed to reduce content.`
          )
        }

        const now = new Date()

        logger.info(
          `[${documentId}] Document parsed successfully, generating embeddings for ${processed.chunks.length} chunks`
        )

        logger.info(`[${documentId}] Fetching document tags`)

        if (processed.chunks.length > 0) {
          const batchSize = Math.min(
            LARGE_DOC_CONFIG.MAX_EMBEDDING_BATCH,
            LARGE_DOC_CONFIG.MAX_CHUNKS_PER_BATCH
          )
          const totalBatches = Math.ceil(processed.chunks.length / batchSize)

          logger.info(
            `[${documentId}] Generating and inserting embeddings in ${totalBatches} batches`
          )

          for (let i = 0; i < processed.chunks.length; i += batchSize) {
            const chunkBatch = processed.chunks.slice(i, i + batchSize)
            const batchNum = Math.floor(i / batchSize) + 1

            logger.info(`[${documentId}] Processing embedding batch ${batchNum}/${totalBatches}`)

            await reauthorize()
            awaitingEmbedding = true
            const batchEmbeddings = await generateEmbeddings(
              chunkBatch.map((chunk) => chunk.text),
              {
                ...scope,
                signal,
                runId: `embedding-document:${documentId}:${batchNum}`,
              },
              kbEmbeddingModel
            )
            awaitingEmbedding = false
            completedBatches += batchEmbeddings.usage.batches
            if (batchEmbeddings.tokens.prompt !== undefined)
              completedPrompt = (completedPrompt ?? 0) + batchEmbeddings.tokens.prompt
            signal.throwIfAborted()

            logger.info('Document embedding usage', {
              documentId,
              model: batchEmbeddings.model,
              tokens: batchEmbeddings.tokens,
              usage: batchEmbeddings.usage,
              cost: batchEmbeddings.cost,
            })

            await reauthorize()
            const inserted = await db
              .transaction(async (tx) => {
                const [documentTags] = await tx
                  .select({
                    tag1: document.tag1,
                    tag2: document.tag2,
                    tag3: document.tag3,
                    tag4: document.tag4,
                    tag5: document.tag5,
                    tag6: document.tag6,
                    tag7: document.tag7,
                  })
                  .from(document)
                  .where(sourceWhere())
                  .for('update')
                  .limit(1)

                if (!documentTags) {
                  return false
                }

                const embeddingRecords = chunkBatch.map((chunk, batchIndex) => {
                  const chunkIndex = i + batchIndex

                  return {
                    id: crypto.randomUUID(),
                    knowledgeBaseId,
                    documentId,
                    chunkIndex,
                    chunkHash: crypto.createHash('sha256').update(chunk.text).digest('hex'),
                    content: chunk.text,
                    contentLength: chunk.text.length,
                    tokenCount: Math.ceil(chunk.text.length / 4),
                    embedding: batchEmbeddings.embeddings[batchIndex] || null,
                    embeddingModel: kbEmbeddingModel,
                    startOffset: chunk.metadata.startIndex,
                    endOffset: chunk.metadata.endIndex,
                    // Copy tags from document
                    tag1: documentTags.tag1,
                    tag2: documentTags.tag2,
                    tag3: documentTags.tag3,
                    tag4: documentTags.tag4,
                    tag5: documentTags.tag5,
                    tag6: documentTags.tag6,
                    tag7: documentTags.tag7,
                    createdAt: now,
                    updatedAt: now,
                  }
                })

                await tx.insert(embedding).values(embeddingRecords)
                return true
              })
              .catch((error) => {
                const failure = error instanceof Error ? error : new Error(String(error))
                Object.assign(failure, {
                  model: batchEmbeddings.model,
                  completedEmbeddings: batchEmbeddings.embeddings,
                })
                throw failure
              })

            if (!inserted) {
              logger.info(`[${documentId}] Stopped embedding inserts for deleted document`)
              return
            }

            logger.info(
              `[${documentId}] Inserted embedding batch ${batchNum}/${totalBatches} (${chunkBatch.length} records)`
            )
          }
        }

        await reauthorize()
        await db.transaction(async (tx) => {
          const [currentDocument] = await tx
            .select({ deletedAt: document.deletedAt })
            .from(document)
            .where(sourceWhere())
            .for('update')
            .limit(1)

          if (!currentDocument) {
            logger.info(`[${documentId}] Skipping completion update for deleted document`)
            return
          }

          await tx
            .update(document)
            .set({
              chunkCount: processed.metadata.chunkCount,
              tokenCount: processed.metadata.tokenCount,
              characterCount: processed.metadata.characterCount,
              processingStatus: 'completed',
              processingCompletedAt: now,
              processingError: null,
            })
            .where(eq(document.id, documentId))
        })
      })(),
      TIMEOUTS.OVERALL_PROCESSING,
      'Document processing',
      () => controller.abort(new Error('Document processing deadline exceeded'))
    )

    const processingTime = Date.now() - startTime
    logger.info(`[${documentId}] Successfully processed document in ${processingTime}ms`)
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    if (awaitingEmbedding) {
      const partial = getFailureAccounting(failure)
      const tokens = partial.tokens as { prompt?: number } | undefined
      const usage = partial.embeddingUsage as { batches?: number } | undefined
      if (tokens?.prompt !== undefined) completedPrompt = (completedPrompt ?? 0) + tokens.prompt
      completedBatches += usage?.batches ?? 0
    }
    if (completedBatches)
      Object.assign(failure, {
        tokens:
          completedPrompt === undefined ? {} : { prompt: completedPrompt, total: completedPrompt },
        embeddingUsage: {
          status: completedPrompt === undefined ? 'unavailable' : 'partial',
          batches: completedBatches,
        },
        cost: { status: 'unavailable' },
      })
    const processingTime = Date.now() - startTime
    logger.error(`[${documentId}] Failed to process document after ${processingTime}ms:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      filename: docData.filename,
      fileUrl: docData.fileUrl,
      mimeType: docData.mimeType,
      ...getFailureAccounting(error),
    })

    // Denied/misbound sources must never mutate another document's status or embeddings.
    if (authorized)
      await (async () => {
        await reauthorize(false)
        await markDocumentProcessingFailed(
          knowledgeBaseId,
          documentId,
          docData,
          scope,
          failure.message
        )
      })().catch((persistenceError) => {
        logger.error(`[${documentId}] Could not persist document failure`, {
          persistenceError,
          ...getFailureAccounting(failure),
        })
      })

    throw failure
  }
}

async function prepareDocumentForProcessing(
  documentId: string,
  sourceWhere: ReturnType<typeof and>
) {
  await db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
        processingCompletedAt: null,
        processingError: null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
      })
      .where(sourceWhere)
  })
}

export async function enqueueDocumentProcessingJobs(
  documents: DocumentProcessingRequestPayload[],
  requestId: string,
  actorUserId: string
): Promise<string[]> {
  if (!actorUserId?.trim()) throw new Error('Authenticated document processing actor is required')
  if (documents.length === 0) {
    return []
  }

  if (documents.some((entry) => entry.knowledgeBaseId !== documents[0].knowledgeBaseId))
    throw new Error('Document batch must use one knowledge base')
  const [knowledgeBaseScope] = await db
    .select({
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, documents[0].knowledgeBaseId))
    .limit(1)

  if (!knowledgeBaseScope) {
    throw new Error('Knowledge base not found')
  }

  logger.info(`[${requestId}] Queueing ${documents.length} document pending executions`)

  const jobIds = await Promise.all(
    documents.map(async (document) => {
      const pendingExecutionId = `document_processing:${document.documentId}:${requestId}`
      const job = await enqueuePendingExecution({
        executionType: 'document',
        pendingExecutionId,
        workspaceId: knowledgeBaseScope.workspaceId,
        userId: actorUserId,
        source: 'document_processing',
        requestId,
        payload: {
          ...document,
          userId: actorUserId,
          workspaceId: knowledgeBaseScope.workspaceId,
        },
      })
      return job.pendingExecutionId
    })
  )

  logger.info(`[${requestId}] Queued ${jobIds.length} document pending executions`)
  return jobIds
}

/**
 * Create document records in database with tags
 */
export async function createDocumentRecords(
  documents: Array<{
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  }>,
  knowledgeBaseId: string,
  requestId: string,
  userId?: string
): Promise<DocumentData[]> {
  // Check storage limits before creating documents
  if (userId) {
    const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0)

    // Get knowledge base owner
    const kb = await db
      .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
      .limit(1)

    if (kb.length === 0) {
      throw new Error('Knowledge base not found')
    }

    // Always meter the knowledge base owner
    const quotaCheck = await checkStorageQuota(kb[0].userId, totalSize, kb[0].workspaceId)

    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.error || 'Storage limit exceeded')
    }
  }

  return await db.transaction(async (tx) => {
    const now = new Date()
    const documentRecords = []
    const returnData: DocumentData[] = []

    for (const docData of documents) {
      const documentId = randomUUID()

      let processedTags: Record<string, string | null> = {
        tag1: null,
        tag2: null,
        tag3: null,
        tag4: null,
        tag5: null,
        tag6: null,
        tag7: null,
      }

      if (docData.documentTagsData) {
        try {
          const tagData = JSON.parse(docData.documentTagsData)
          if (Array.isArray(tagData)) {
            processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
          }
        } catch (error) {
          logger.warn(`[${requestId}] Failed to parse documentTagsData for bulk document:`, error)
        }
      }

      const newDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingStatus: 'pending' as const,
        enabled: true,
        uploadedAt: now,
        // Use processed tags if available, otherwise fall back to individual tag fields
        tag1: processedTags.tag1 || docData.tag1 || null,
        tag2: processedTags.tag2 || docData.tag2 || null,
        tag3: processedTags.tag3 || docData.tag3 || null,
        tag4: processedTags.tag4 || docData.tag4 || null,
        tag5: processedTags.tag5 || docData.tag5 || null,
        tag6: processedTags.tag6 || docData.tag6 || null,
        tag7: processedTags.tag7 || docData.tag7 || null,
      }

      documentRecords.push(newDocument)
      returnData.push({
        documentId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
        uploadedAt: now,
        tag1: newDocument.tag1,
        tag2: newDocument.tag2,
        tag3: newDocument.tag3,
        tag4: newDocument.tag4,
        tag5: newDocument.tag5,
        tag6: newDocument.tag6,
        tag7: newDocument.tag7,
      })
    }

    if (documentRecords.length > 0) {
      await tx.insert(document).values(documentRecords)
      logger.info(
        `[${requestId}] Bulk created ${documentRecords.length} document records in knowledge base ${knowledgeBaseId}`
      )

      // Increment storage usage tracking
      if (userId) {
        const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0)

        // Get knowledge base owner
        const kb = await db
          .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, knowledgeBaseId))
          .limit(1)

        if (kb.length > 0) {
          // Always meter the knowledge base owner
          try {
            await incrementStorageUsage(kb[0].userId, totalSize, kb[0].workspaceId)
            logger.info(
              `[${requestId}] Updated knowledge base owner storage usage for ${totalSize} bytes`
            )
          } catch (error) {
            logger.error(
              `[${requestId}] Failed to update knowledge base owner storage usage:`,
              error
            )
          }
        }
      }
    }

    return returnData
  })
}

/**
 * Get documents for a knowledge base with filtering and pagination
 */
export async function getDocuments(
  knowledgeBaseId: string,
  options: {
    includeDisabled?: boolean
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
  },
  requestId: string
): Promise<{
  documents: Array<{
    id: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    processingError: string | null
    enabled: boolean
    uploadedAt: Date
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  const {
    includeDisabled = false,
    search,
    limit = 50,
    offset = 0,
    sortBy = 'filename',
    sortOrder = 'asc',
  } = options

  // Build where conditions
  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  // Filter out disabled documents unless specifically requested
  if (!includeDisabled) {
    whereConditions.push(eq(document.enabled, true))
  }

  // Add search condition if provided
  if (search) {
    whereConditions.push(
      // Search in filename
      sql`LOWER(${document.filename}) LIKE LOWER(${`%${search}%`})`
    )
  }

  // Get total count for pagination
  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = totalResult[0]?.count || 0
  const hasMore = offset + limit < total

  // Create dynamic order by clause
  const getOrderByColumn = () => {
    switch (sortBy) {
      case 'filename':
        return document.filename
      case 'fileSize':
        return document.fileSize
      case 'tokenCount':
        return document.tokenCount
      case 'chunkCount':
        return document.chunkCount
      case 'uploadedAt':
        return document.uploadedAt
      case 'processingStatus':
        return document.processingStatus
      default:
        return document.uploadedAt
    }
  }

  // Use stable secondary sort to prevent shifting when primary values are identical
  const primaryOrderBy = sortOrder === 'asc' ? asc(getOrderByColumn()) : desc(getOrderByColumn())
  const secondaryOrderBy =
    sortBy === 'filename' ? desc(document.uploadedAt) : asc(document.filename)

  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      processingStatus: document.processingStatus,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      processingError: document.processingError,
      enabled: document.enabled,
      uploadedAt: document.uploadedAt,
      // Include tags in response
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
    })
    .from(document)
    .where(and(...whereConditions))
    .orderBy(primaryOrderBy, secondaryOrderBy)
    .limit(limit)
    .offset(offset)

  logger.info(
    `[${requestId}] Retrieved ${documents.length} documents (${offset}-${offset + documents.length} of ${total}) for knowledge base ${knowledgeBaseId}`
  )

  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      chunkCount: doc.chunkCount,
      tokenCount: doc.tokenCount,
      characterCount: doc.characterCount,
      processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
      processingError: doc.processingError,
      enabled: doc.enabled,
      uploadedAt: doc.uploadedAt,
      tag1: doc.tag1,
      tag2: doc.tag2,
      tag3: doc.tag3,
      tag4: doc.tag4,
      tag5: doc.tag5,
      tag6: doc.tag6,
      tag7: doc.tag7,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore,
    },
  }
}

/**
 * Perform bulk operations on documents
 */
export async function bulkDocumentOperation(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  documentIds: string[],
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>
  storageCleanup?: KnowledgeDocumentFileCleanup
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on ${documentIds.length} documents in knowledge base ${knowledgeBaseId}`
  )

  // Verify all documents belong to this knowledge base
  const documentsToUpdate = await db
    .select({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      enabled: document.enabled,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
    })
    .from(document)
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        inArray(document.id, documentIds),
        isNull(document.deletedAt)
      )
    )

  if (documentsToUpdate.length === 0) {
    throw new Error('No valid documents found to update')
  }

  if (documentsToUpdate.length !== documentIds.length) {
    logger.warn(
      `[${requestId}] Some documents not found or don't belong to knowledge base. Requested: ${documentIds.length}, Found: ${documentsToUpdate.length}`
    )
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>

  let storageCleanup: KnowledgeDocumentFileCleanup | undefined
  if (operation === 'delete') {
    const deletion = await deleteDocumentTargets(documentsToUpdate, requestId)
    updateResult = deletion.documents
    storageCleanup = deletion.storageCleanup
  } else {
    // Handle bulk enable/disable
    const enabled = operation === 'enable'

    updateResult = await db
      .update(document)
      .set({
        enabled,
      })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(document.id, documentIds),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} operation completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return {
    success: true,
    successCount,
    updatedDocuments: updateResult,
    ...(storageCleanup ? { storageCleanup } : {}),
  }
}

/**
 * Retry processing a failed document
 */
export async function retryDocumentProcessing(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  requestId: string,
  actorUserId: string
): Promise<{ success: boolean; status: string; message: string }> {
  const processingOptions = {
    chunkSize: 512,
    minCharactersPerChunk: 24,
    chunkOverlap: 100,
  }

  await enqueueDocumentProcessingJobs(
    [
      {
        knowledgeBaseId,
        documentId,
        docData,
        processingOptions,
        requestId,
      },
    ],
    requestId,
    actorUserId
  )

  logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

  return {
    success: true,
    status: 'pending',
    message: 'Document retry processing started',
  }
}

export async function failStaleDocumentProcessing(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; status: string; message: string }> {
  await db.transaction(async (tx) => {
    await tx
      .delete(pendingExecution)
      .where(
        and(
          eq(pendingExecution.executionType, 'document'),
          sql<boolean>`${pendingExecution.id} like ${`document_processing:${documentId}:%`}`
        )
      )

    const [failedDocument] = await tx
      .update(document)
      .set({
        processingStatus: 'failed',
        processingStartedAt: null,
        processingCompletedAt: new Date(),
        processingError: 'Document processing exceeded the recovery window and was stopped.',
      })
      .where(
        and(
          eq(document.id, documentId),
          eq(document.processingStatus, 'processing'),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id })

    if (!failedDocument) {
      const [activeDocument] = await tx
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.id, documentId), isNull(document.deletedAt)))
        .limit(1)

      if (activeDocument) return
    }

    await tx.delete(embedding).where(eq(embedding.documentId, documentId))
  })

  logger.warn(`[${requestId}] Stale document processing marked as failed: ${documentId}`)

  return {
    success: true,
    status: 'failed',
    message: 'Document processing marked as failed',
  }
}

/**
 * Update a document with specified fields
 */
export async function updateDocument(
  documentId: string,
  updateData: {
    filename?: string
    enabled?: boolean
    chunkCount?: number
    tokenCount?: number
    characterCount?: number
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    processingError?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  },
  requestId: string
): Promise<{
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingError: string | null
  enabled: boolean
  uploadedAt: Date
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  deletedAt: Date | null
}> {
  const dbUpdateData: Partial<{
    filename: string
    enabled: boolean
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingError: string | null
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
  }> = {}
  const TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const
  type TagSlot = (typeof TAG_SLOTS)[number]

  // Regular field updates
  if (updateData.filename !== undefined) dbUpdateData.filename = updateData.filename
  if (updateData.enabled !== undefined) dbUpdateData.enabled = updateData.enabled
  if (updateData.chunkCount !== undefined) dbUpdateData.chunkCount = updateData.chunkCount
  if (updateData.tokenCount !== undefined) dbUpdateData.tokenCount = updateData.tokenCount
  if (updateData.characterCount !== undefined)
    dbUpdateData.characterCount = updateData.characterCount
  if (updateData.processingStatus !== undefined)
    dbUpdateData.processingStatus = updateData.processingStatus
  if (updateData.processingError !== undefined)
    dbUpdateData.processingError = updateData.processingError

  TAG_SLOTS.forEach((slot: TagSlot) => {
    const updateValue = (updateData as any)[slot]
    if (updateValue !== undefined) {
      ;(dbUpdateData as any)[slot] = updateValue
    }
  })

  await db.transaction(async (tx) => {
    await tx.update(document).set(dbUpdateData).where(eq(document.id, documentId))

    const hasTagUpdates = TAG_SLOTS.some((field) => (updateData as any)[field] !== undefined)

    if (hasTagUpdates) {
      const embeddingUpdateData: Record<string, string | null> = {}
      TAG_SLOTS.forEach((field) => {
        if ((updateData as any)[field] !== undefined) {
          embeddingUpdateData[field] = (updateData as any)[field] || null
        }
      })

      await tx
        .update(embedding)
        .set(embeddingUpdateData)
        .where(eq(embedding.documentId, documentId))
    }
  })

  const updatedDocument = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1)

  if (updatedDocument.length === 0) {
    throw new Error(`Document ${documentId} not found`)
  }

  logger.info(`[${requestId}] Document updated: ${documentId}`)

  const doc = updatedDocument[0]
  return {
    id: doc.id,
    knowledgeBaseId: doc.knowledgeBaseId,
    filename: doc.filename,
    fileUrl: doc.fileUrl,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    chunkCount: doc.chunkCount,
    tokenCount: doc.tokenCount,
    characterCount: doc.characterCount,
    processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
    processingStartedAt: doc.processingStartedAt,
    processingCompletedAt: doc.processingCompletedAt,
    processingError: doc.processingError,
    enabled: doc.enabled,
    uploadedAt: doc.uploadedAt,
    tag1: doc.tag1,
    tag2: doc.tag2,
    tag3: doc.tag3,
    tag4: doc.tag4,
    tag5: doc.tag5,
    tag6: doc.tag6,
    tag7: doc.tag7,
    deletedAt: doc.deletedAt,
  }
}

export async function deleteDocument(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; message: string; storageCleanup: KnowledgeDocumentFileCleanup }> {
  const [documentToDelete] = await db
    .select({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
    })
    .from(document)
    .where(and(eq(document.id, documentId), isNull(document.deletedAt)))
    .limit(1)

  if (!documentToDelete) {
    throw new Error(`Document ${documentId} not found`)
  }

  const { storageCleanup } = await deleteDocumentTargets([documentToDelete], requestId)

  logger.info(`[${requestId}] Document deleted: ${documentId}`)

  return {
    success: true,
    message: storageCleanup.retained.length
      ? 'Document deleted; stored files were retained because physical deletion could not be verified or completed'
      : 'Document deleted successfully',
    storageCleanup,
  }
}
