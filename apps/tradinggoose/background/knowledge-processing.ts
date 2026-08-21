import { task } from '@trigger.dev/sdk'
import { env } from '@/lib/env'
import {
  markDocumentProcessingFailed,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeProcessing')

const envNumber = (value: unknown, fallback: number, min = 1) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
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
  requestId: string
}

function isDocumentProcessingPayload(value: unknown): value is DocumentProcessingPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const docData = candidate.docData as Record<string, unknown> | null
  const processingOptions = candidate.processingOptions as Record<string, unknown> | null
  return (
    typeof candidate.knowledgeBaseId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.requestId === 'string' &&
    typeof docData?.filename === 'string' &&
    typeof docData.fileUrl === 'string' &&
    typeof docData.fileSize === 'number' &&
    typeof docData.mimeType === 'string' &&
    typeof processingOptions?.chunkSize === 'number' &&
    typeof processingOptions.minCharactersPerChunk === 'number' &&
    typeof processingOptions.chunkOverlap === 'number'
  )
}

function requireDocumentProcessingPayload(value: unknown): DocumentProcessingPayload {
  if (isDocumentProcessingPayload(value)) return value
  throw new Error('Invalid document pending payload')
}

export async function executeDocumentProcessingJob(value: unknown) {
  const payload = requireDocumentProcessingPayload(value)
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload

  logger.info(`[${requestId}] Starting document pending execution: ${docData.filename}`)

  try {
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
  run: (payload: DocumentProcessingPayload) => executeDocumentProcessingJob(payload),
})

export async function executeTriggeredDocumentProcessingJob(value: unknown) {
  const payload = requireDocumentProcessingPayload(value)
  await processDocument.triggerAndWait(payload).unwrap()
}

export async function markDocumentProcessingJobFailed(value: unknown, errorMessage: string) {
  if (!value || typeof value !== 'object') return
  const { documentId } = value as Record<string, unknown>
  if (typeof documentId === 'string') await markDocumentProcessingFailed(documentId, errorMessage)
}
