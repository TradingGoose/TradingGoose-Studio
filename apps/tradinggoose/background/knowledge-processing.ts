import { getDocumentProcessingMaxDurationSeconds } from '@/lib/knowledge/documents/config'
import {
  markDocumentProcessingFailed,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeProcessing')

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

export async function executeDocumentProcessingJob(value: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const payload = requireDocumentProcessingPayload(value)
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload
  const duration = getDocumentProcessingMaxDurationSeconds()
  const deadline = new AbortController()
  const processingSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const timer = setTimeout(
    () => deadline.abort(new Error(`Document processing timed out after ${duration} seconds`)),
    duration * 1_000
  )
  let onAbort!: () => void
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(processingSignal.reason)
    processingSignal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    logger.info(`[${requestId}] Starting document pending execution: ${docData.filename}`)
    await Promise.race([
      processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions, {
        actorUserId: payload.userId,
        workspaceId: payload.workspaceId,
        signal: processingSignal,
      }),
      interrupted,
    ])

    logger.info(
      `[${requestId}] Successfully completed document pending execution: ${docData.filename}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed document pending execution: ${docData.filename}`, error)
    throw error
  } finally {
    clearTimeout(timer)
    processingSignal.removeEventListener('abort', onAbort)
  }
}

export async function markDocumentProcessingJobFailed(value: unknown, errorMessage: string) {
  if (!isDocumentProcessingPayload(value)) return
  await markDocumentProcessingFailed(value.documentId, errorMessage)
}
