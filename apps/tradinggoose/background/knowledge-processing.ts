import { task } from '@trigger.dev/sdk'
import {
  markDocumentProcessingFailed,
  prepareDocumentForProcessing,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeProcessing')

const envNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export type DocumentProcessingPayload = {
  knowledgeBaseId: string
  documentId: string
  userId: string
  workspaceId: string
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: {
    chunkSize: number
    minCharactersPerChunk: number
    chunkOverlap: number
  }
  resetBeforeProcessing?: boolean
  requestId: string
}

function isDocumentProcessingPayload(value: unknown): value is DocumentProcessingPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.knowledgeBaseId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.requestId === 'string'
  )
}

async function executeDocumentProcessingJob(payload: DocumentProcessingPayload) {
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload

  logger.info(`[${requestId}] Starting document pending execution: ${docData.filename}`)

  try {
    if (payload.resetBeforeProcessing) {
      await prepareDocumentForProcessing(documentId)
    }

    await processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions)

    logger.info(
      `[${requestId}] Successfully completed document pending execution: ${docData.filename}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed document pending execution: ${docData.filename}`, error)
    throw error
  }
}

export const processDocument = task({
  id: 'knowledge-process-document',
  maxDuration: envNumber(env.KB_CONFIG_MAX_DURATION, 600),
  machine: 'large-1x',
  retry: {
    maxAttempts: envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3),
    factor: envNumber(env.KB_CONFIG_RETRY_FACTOR, 2),
    minTimeoutInMs: envNumber(env.KB_CONFIG_MIN_TIMEOUT, 1000),
    maxTimeoutInMs: envNumber(env.KB_CONFIG_MAX_TIMEOUT, 10000),
  },
  queue: {
    concurrencyLimit: envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20),
    name: 'document-processing-queue',
  },
  run: executeDocumentProcessingJob,
})

export async function dispatchQueuedDocumentProcessingJob(payload: unknown) {
  if (!isDocumentProcessingPayload(payload)) {
    throw new Error('Invalid document pending payload')
  }

  await processDocument.triggerAndWait(payload).unwrap()
}

export async function failQueuedDocumentProcessingJob(payload: unknown, errorMessage: string) {
  if (!isDocumentProcessingPayload(payload)) {
    return
  }

  await markDocumentProcessingFailed(payload.documentId, errorMessage)
}
