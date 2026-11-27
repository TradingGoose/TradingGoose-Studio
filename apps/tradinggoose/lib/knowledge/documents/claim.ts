import { db } from '@tradinggoose/db'
import { document, embedding, knowledgeBase, pendingExecution } from '@tradinggoose/db/schema'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { PendingExecutionTransaction } from '@/lib/execution/pending-execution'

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

export function isDocumentProcessingPayload(value: unknown): value is DocumentProcessingPayload {
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

export type DocumentAttempt = { id: string; localDocumentNonce?: string }

const utcNow = sql`(clock_timestamp() at time zone 'UTC')`
const cutoff = sql`${utcNow} - interval '90 seconds'`
const processingDocument = and(
  eq(pendingExecution.executionType, 'document'),
  eq(pendingExecution.status, 'processing'),
  eq(pendingExecution.source, 'document_processing')
)

function ownerPredicate(attempt: DocumentAttempt) {
  return and(
    processingDocument,
    eq(pendingExecution.id, attempt.id),
    attempt.localDocumentNonce === undefined
      ? ne(pendingExecution.billingScopeType, 'local')
      : and(
          eq(pendingExecution.billingScopeType, 'local'),
          sql`${pendingExecution.payload}->>'localDocumentNonce' = ${attempt.localDocumentNonce}`,
          sql`${pendingExecution.updatedAt} > ${cutoff}`
        )
  )
}

type Marker = typeof pendingExecution.$inferSelect

function boundPayload(row: Marker) {
  const p = row.payload
  return isDocumentProcessingPayload(p) &&
    row.id === `document_processing:${p.documentId}:${p.requestId}` &&
    row.userId === p.userId &&
    row.workspaceId === p.workspaceId
    ? p
    : null
}

async function lockDocument(tx: PendingExecutionTransaction, p: DocumentProcessingPayload) {
  const [doc] = await tx
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, p.documentId),
        eq(document.knowledgeBaseId, p.knowledgeBaseId),
        sql`exists (select 1 from ${knowledgeBase} where ${knowledgeBase.id} = ${p.knowledgeBaseId}
        and ${knowledgeBase.workspaceId} = ${p.workspaceId})`
      )
    )
    .for('update')
  return doc
}

async function retireMarker(tx: PendingExecutionTransaction, id: string) {
  const [retired] = await tx
    .delete(pendingExecution)
    .where(eq(pendingExecution.id, id))
    .returning({ id: pendingExecution.id })
  if (!retired) throw new Error('Document attempt retirement failed')
}

// All processing writes lock the queue marker first and keep both locks through commit.
export async function writeDocumentAttempt(
  attempt: DocumentAttempt,
  payload: DocumentProcessingPayload,
  stage: 'prepare' | 'batch' | 'complete',
  write: (tx: PendingExecutionTransaction, doc: typeof document.$inferSelect) => Promise<void>
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingExecution)
      .where(ownerPredicate(attempt))
      .for('update')
    const saved = row && boundPayload(row)
    if (
      !saved ||
      saved.documentId !== payload.documentId ||
      saved.knowledgeBaseId !== payload.knowledgeBaseId ||
      saved.workspaceId !== payload.workspaceId ||
      saved.userId !== payload.userId
    )
      throw new Error('Document processing attempt is no longer active')
    const doc = await lockDocument(tx, saved)
    if (!doc || doc.deletedAt) {
      if (doc?.deletedAt) await tx.delete(embedding).where(eq(embedding.documentId, doc.id))
      await retireMarker(tx, row.id)
      return false
    }
    if (
      !(
        doc.processingStatus === 'processing' ||
        (stage === 'prepare' && doc.processingStatus === 'pending')
      )
    )
      throw new Error('Document is no longer pending processing')
    await write(tx, doc)
    if (stage === 'complete') await retireMarker(tx, row.id)
    else if (attempt.localDocumentNonce)
      await tx
        .update(pendingExecution)
        .set({ updatedAt: utcNow })
        .where(eq(pendingExecution.id, row.id))
    return true
  })
}

export async function checkDocumentAttempt(attempt: DocumentAttempt) {
  const [owner] = await db
    .select({ id: pendingExecution.id })
    .from(pendingExecution)
    .where(ownerPredicate(attempt))
  if (!owner) throw new Error('Document processing attempt is no longer active')
}

async function failLockedDocument(tx: PendingExecutionTransaction, row: Marker, message: string) {
  const p = boundPayload(row)
  if (p) {
    const doc = await lockDocument(tx, p)
    if (doc && (doc.deletedAt || doc.processingStatus !== 'completed')) {
      if (!doc.deletedAt && ['pending', 'processing'].includes(doc.processingStatus))
        await tx
          .update(document)
          .set({
            processingStatus: 'failed',
            processingStartedAt: null,
            processingCompletedAt: new Date(),
            processingError: message,
          })
          .where(eq(document.id, doc.id))
      await tx.delete(embedding).where(eq(embedding.documentId, doc.id))
    }
  }
  await retireMarker(tx, row.id)
}

export async function failDocumentAttempt(attempt: DocumentAttempt, message: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(pendingExecution)
      .where(ownerPredicate(attempt))
      .for('update')
    if (!row) return false
    await failLockedDocument(tx, row, message)
    return true
  })
}

export async function recoverInterruptedLocalDocuments(
  knowledgeBaseId?: string,
  documentId?: string
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pendingExecution)
      .where(
        and(
          processingDocument,
          eq(pendingExecution.billingScopeType, 'local'),
          sql`${pendingExecution.updatedAt} <= ${cutoff}`,
          knowledgeBaseId !== undefined
            ? sql`${pendingExecution.payload}->>'knowledgeBaseId' = ${knowledgeBaseId}`
            : undefined,
          documentId !== undefined
            ? sql`${pendingExecution.payload}->>'documentId' = ${documentId}`
            : undefined
        )
      )
      .orderBy(pendingExecution.id)
      .for('update', { skipLocked: true })
    for (const row of rows)
      await failLockedDocument(tx, row, 'Local document processing was interrupted.')
    return rows.length
  })
}

export async function reserveDocumentRetry(
  tx: PendingExecutionTransaction,
  knowledgeBaseId: string,
  documentId: string
) {
  const [reserved] = await tx
    .update(document)
    .set({
      processingStatus: 'pending',
      processingError: null,
      processingStartedAt: null,
      processingCompletedAt: null,
    })
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.processingStatus, 'failed'),
        sql`${document.deletedAt} is null`,
        sql`not exists (select 1 from ${pendingExecution} where ${pendingExecution.executionType} = 'document'
      and ${inArray(pendingExecution.status, ['pending', 'processing'])}
      and ${pendingExecution.payload}->>'knowledgeBaseId' = ${knowledgeBaseId}
      and ${pendingExecution.payload}->>'documentId' = ${documentId})`
      )
    )
    .returning({ id: document.id })
  return Boolean(reserved)
}
