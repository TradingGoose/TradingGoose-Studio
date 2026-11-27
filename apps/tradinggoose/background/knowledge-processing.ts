import type { DocumentAttempt } from '@/lib/knowledge/documents/claim'
import { isDocumentProcessingPayload } from '@/lib/knowledge/documents/claim'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

export async function executeDocumentProcessingJob(
  job: { id: string; payload: unknown },
  signal?: AbortSignal,
  localDocumentNonce?: string
) {
  signal?.throwIfAborted()
  if (!isDocumentProcessingPayload(job.payload)) throw new Error('Invalid document pending payload')
  const attempt: DocumentAttempt = { id: job.id, localDocumentNonce }
  await processDocumentAsync(job.payload, attempt, signal)
}
