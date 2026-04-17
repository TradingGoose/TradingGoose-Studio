import { withExecutionConcurrencyLimit } from '@/lib/execution/execution-concurrency-limit'
import {
  prepareDocumentForProcessing,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeProcessing')

export type DocumentProcessingPayload = {
  knowledgeBaseId: string
  documentId: string
  userId: string
  workspaceId?: string | null
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: {
    chunkSize?: number
    minCharactersPerChunk?: number
    recipe?: string
    lang?: string
    chunkOverlap?: number
  }
  resetBeforeProcessing?: boolean
  requestId: string
}

export function isDocumentProcessingPayload(
  value: unknown,
): value is DocumentProcessingPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.knowledgeBaseId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.requestId === 'string'
  )
}

export async function executeDocumentProcessingJob(
  payload: DocumentProcessingPayload,
) {
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } =
    payload

  logger.info(
    `[${requestId}] Starting document pending execution: ${docData.filename}`,
  )

  try {
    await withExecutionConcurrencyLimit({
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      task: async () => {
        if (payload.resetBeforeProcessing) {
          await prepareDocumentForProcessing(documentId)
        }

        await processDocumentAsync(
          knowledgeBaseId,
          documentId,
          docData,
          processingOptions,
        )
      },
    })

    logger.info(
      `[${requestId}] Successfully completed document pending execution: ${docData.filename}`,
    )
  } catch (error) {
    logger.error(
      `[${requestId}] Failed document pending execution: ${docData.filename}`,
      error,
    )
    throw error
  }
}
