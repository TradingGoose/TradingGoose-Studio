import { db } from '@tradinggoose/db'
import {
  orderHistoryTable,
  pendingExecution,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowLogWebhookDelivery,
  workspace,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { readWorkflowExecutionResultFromLog } from '@/lib/execution/workflow-execution-events'
import { getNativeMemoryStore } from '@/lib/mastra/runtime'
import {
  type NativePayloadRef,
  readFunctionalPayload,
  readNativePayloadMessages,
  workflowAgentPayloadResource,
} from '@/lib/mastra/workflow-history'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { decryptSecret } from '@/lib/utils-server'
import type { WorkflowCheckpointSnapshot } from '@/lib/workflows/human-in-the-loop/types'
import { restoreExecutionContext, saveExecutionContext } from '@/executor/checkpoint'
import { type ArchiveReference, functionalDigest } from './format'
import {
  assertRetainedLogAccess,
  FUNCTIONAL_OUTPUT_REFERENCE,
  hydrateFunctionalBlocks,
  projectFunctionalBlocks,
} from './functional'
import { projectHistoricalFunctionalPayload } from './historical'
import { readPrivateArchive, writePrivateArchive } from './io'

type ExecutionLog = typeof workflowExecutionLogs.$inferSelect
export class ArchiveBusyError extends Error {
  readonly status = 409
}

export class ArchivePruneDeferredError extends ArchiveBusyError {
  constructor() {
    super('Native workflow payload deletion is deferred until scoped writer quiescence is verified')
    this.name = 'ArchivePruneDeferredError'
  }
}

async function assertNoConsumers(row: ExecutionLog, connection: Pick<typeof db, 'select'> = db) {
  const data = row.executionData as any
  if (!row.endedAt || data?.checkpoint || data?.pause)
    throw new ArchiveBusyError('Active or unverified checkpoint payload is pinned')
  const [queued] = await connection
    .select({ id: pendingExecution.id })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.workspaceId, row.workspaceId),
        inArray(pendingExecution.status, ['pending', 'processing'])
      )
    )
    .limit(1)
  const [webhook] = await connection
    .select({ id: workflowLogWebhookDelivery.id })
    .from(workflowLogWebhookDelivery)
    .where(
      and(
        eq(workflowLogWebhookDelivery.executionId, row.executionId!),
        inArray(workflowLogWebhookDelivery.status, ['pending', 'in_progress'])
      )
    )
    .limit(1)
  const [order] = await connection
    .select({ id: orderHistoryTable.id })
    .from(orderHistoryTable)
    .where(eq(orderHistoryTable.logId, row.id))
    .limit(1)
  const parentId = data?.trigger?.data?.queuedExecution?.parentExecutionId
  let activeParent = false
  if (typeof parentId === 'string') {
    const [parent] = await connection
      .select({ endedAt: workflowExecutionLogs.endedAt })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, parentId))
      .limit(1)
    activeParent = Boolean(parent && !parent.endedAt)
  }
  if (queued || webhook || order || activeParent)
    throw new ArchiveBusyError(
      'Workflow payload is still required by a queue, parent, webhook or order consumer'
    )
}

function sourceFingerprint(row: ExecutionLog): string {
  const data = { ...(row.executionData as any) }
  data.workflowArchive = undefined
  return functionalDigest({ ...row, executionData: data })
}

function retainedBusinessRecord(row: ExecutionLog) {
  const {
    traceSpans: _trace,
    tokenBreakdown: _tokens,
    models: _models,
    functionalPayload: _functional,
    nativePayloads: _native,
    workflowArchive: _archive,
    preservedFunctionalArchive: _preserved,
    finalOutput: _output,
    ...retained
  } = row.executionData as any
  return {
    ...row,
    cost: null,
    executionData: { ...retained, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE },
  }
}

async function currentLog(logId: string): Promise<ExecutionLog> {
  const [row] = await db
    .select()
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.id, logId))
    .limit(1)
  if (!row?.executionId) throw new Error('Workflow archive owning execution is missing')
  return row
}

function scopedReference(ref: NativePayloadRef, row: ExecutionLog) {
  if (
    ref.purpose !== 'workflow-agent' ||
    ref.workspaceId !== row.workspaceId ||
    ref.logId !== row.id ||
    ref.executionId !== row.executionId
  )
    throw new Error('Workflow archive native reference scope mismatch')
}

/** Full self-contained export. The original SQL owner remains until the verified reference commits. */
export async function prepareWorkflowArchive(logId: string): Promise<ArchiveReference> {
  const row = await currentLog(logId)
  await assertNoConsumers(row)
  const data = row.executionData as any
  if (data.workflowArchive) {
    const committed = await readPrivateArchive(data.workflowArchive)
    if (sourceFingerprint(row) !== committed.sourceFingerprint)
      throw new ArchiveBusyError(
        'Business record changed after archive handoff; retain the verified artifact and classify'
      )
    return data.workflowArchive
  }
  if (!data.functionalPayload && !data.preservedFunctionalArchive)
    throw new ArchiveBusyError(
      'Record requires verified offline functional preservation before cleanup'
    )
  let functional: { blocks?: unknown[]; output?: unknown }
  const nativeThreads: Array<{ reference: NativePayloadRef; messages: unknown[] }> = []
  const refs = new Map<string, NativePayloadRef>()
  const retainReference = (ref: NativePayloadRef) => {
    scopedReference(ref, row)
    refs.set(functionalDigest(ref), ref)
  }
  if (data.functionalPayload) {
    functional = await readFunctionalPayload(data.functionalPayload)
    retainReference(data.functionalPayload)
  } else {
    const preserved = await readPrivateArchive(data.preservedFunctionalArchive)
    functional = preserved.functional
  }
  for (const ref of Object.values(data.nativePayloads ?? {}) as NativePayloadRef[]) {
    retainReference(ref)
  }
  for (const block of (functional.blocks ?? []) as Array<{ nativePayload?: NativePayloadRef }>)
    if (block.nativePayload) {
      retainReference(block.nativePayload)
    }
  const store = await getNativeMemoryStore()
  const resourceId = workflowAgentPayloadResource({
    workspaceId: row.workspaceId,
    executionId: row.executionId!,
    logId: row.id,
  })
  const retainedThreads = new Set([...refs.values()].map((ref) => ref.threadId))
  const discoveredThreads = new Set<string>()
  for (let page = 0; ; page++) {
    const listed = await store.listThreads({
      page,
      perPage: 100,
      filter: {
        resourceId,
        metadata: {
          purpose: 'workflow-agent',
          workspaceId: row.workspaceId,
          executionId: row.executionId!,
          logId: row.id,
        },
      },
    })
    if (listed.hasMore && !listed.threads.length)
      throw new Error('Incomplete native archive thread discovery')
    for (const thread of listed.threads) {
      if (
        thread.resourceId !== resourceId ||
        thread.metadata?.purpose !== 'workflow-agent' ||
        thread.metadata?.workspaceId !== row.workspaceId ||
        thread.metadata?.executionId !== row.executionId ||
        thread.metadata?.logId !== row.id ||
        !retainedThreads.has(thread.id) ||
        discoveredThreads.has(thread.id)
      )
        throw new ArchiveBusyError(
          'Unreferenced or mismatched native payload requires classification before destructive cleanup'
        )
      discoveredThreads.add(thread.id)
    }
    if (!listed.hasMore) break
  }
  if (discoveredThreads.size !== retainedThreads.size)
    throw new ArchiveBusyError('Native archive thread membership changed')
  const retainedMessages = new Map<string, Map<string, string>>()
  for (const reference of refs.values()) {
    const messages = await readNativePayloadMessages(reference)
    nativeThreads.push({ reference, messages })
    const retained = retainedMessages.get(reference.threadId) ?? new Map<string, string>()
    retainedMessages.set(reference.threadId, retained)
    for (const message of messages) {
      const fingerprint = functionalDigest(message)
      if (retained.has(message.id) && retained.get(message.id) !== fingerprint)
        throw new ArchiveBusyError('Retained native payload references disagree')
      retained.set(message.id, fingerprint)
    }
  }
  // Exact-reference reads do not establish physical export completeness. Preserve any
  // unreferenced/uncertain candidate instead of silently excluding it from cold handoff.
  for (const [threadId, retained] of retainedMessages) {
    const seen = new Set<string>()
    for (let page = 0; ; page++) {
      const result = await store.listMessages({
        threadId,
        resourceId,
        page,
        perPage: 100,
        includeTotal: true,
        orderBy: { field: 'createdAt', direction: 'ASC' },
      })
      if (
        result.total !== retained.size ||
        result.page !== page ||
        result.perPage !== 100 ||
        result.messages.length > 100 ||
        (result.hasMore && !result.messages.length)
      )
        throw new ArchiveBusyError(
          'Unreferenced or incomplete native payload requires classification'
        )
      for (const message of result.messages) {
        if (
          seen.has(message.id) ||
          message.threadId !== threadId ||
          message.resourceId !== resourceId ||
          retained.get(message.id) !== functionalDigest(message)
        )
          throw new ArchiveBusyError('Native archive payload membership changed')
        seen.add(message.id)
      }
      if (!result.hasMore) break
    }
    if (seen.size !== retained.size)
      throw new ArchiveBusyError('Native archive payload is incomplete')
  }
  const hydrated = await hydrateFunctionalBlocks(functional.blocks ?? [])
  const completeBlocks = projectFunctionalBlocks(hydrated)
  const completeOutput =
    data.finalOutput?.purpose === FUNCTIONAL_OUTPUT_REFERENCE.purpose
      ? functional.output
      : data.finalOutput
  const [snapshot] = await db
    .select()
    .from(workflowExecutionSnapshots)
    .where(
      and(
        eq(workflowExecutionSnapshots.id, row.stateSnapshotId),
        eq(workflowExecutionSnapshots.workspaceId, row.workspaceId)
      )
    )
    .limit(1)
  if (!snapshot)
    throw new Error('Required execution graph snapshot is unavailable; preserve the hot record')
  const source = sourceFingerprint(row)
  const artifact = {
    record: retainedBusinessRecord(row),
    snapshot,
    functional: { blocks: completeBlocks, output: completeOutput },
    nativeThreads,
    sourceFingerprint: source,
  }
  const reference = await writePrivateArchive(
    { workspaceId: row.workspaceId, executionId: row.executionId!, logId: row.id },
    artifact
  )
  const verified = await readPrivateArchive(reference)
  if (
    functionalDigest(verified.functional) !== functionalDigest(artifact.functional) ||
    functionalDigest(verified.nativeThreads) !== functionalDigest(nativeThreads) ||
    functionalDigest(verified.snapshot) !== functionalDigest(snapshot)
  )
    throw new Error('Future-reader archive projection verification failed')
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, row.id))
      .limit(1)
      .for('update')
    if (!current || sourceFingerprint(current) !== source)
      throw new ArchiveBusyError('Workflow archive source changed; retain current data and retry')
    await assertNoConsumers(current, tx)
    await tx
      .update(workflowExecutionLogs)
      .set({ executionData: { ...(current.executionData as any), workflowArchive: reference } })
      .where(eq(workflowExecutionLogs.id, row.id))
  })
  return reference
}

/** A verified export and application row lock do not join an entered native writer. */
export async function pruneArchivedWorkflowPayload(logId: string): Promise<void> {
  const row = await currentLog(logId)
  const reference = (row.executionData as any)?.workflowArchive as ArchiveReference | undefined
  if (!reference) throw new Error('Verified archive handoff must commit before native prune')
  const artifact = await readPrivateArchive(reference)
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, logId))
      .limit(1)
      .for('update')
    if (
      !current ||
      (current.executionData as any)?.workflowArchive?.digest !== reference.digest ||
      sourceFingerprint(current) !== artifact.sourceFingerprint
    )
      throw new ArchiveBusyError('Archive handoff changed')
    await assertNoConsumers(current, tx)
    for (const entry of artifact.nativeThreads as Array<{ reference: NativePayloadRef }>)
      scopedReference(entry.reference, current)
    // Native absence, a terminal owner and admission flags are not producer settlement.
    throw new ArchivePruneDeferredError()
  })
}

export async function deleteArchivedWorkflowLog(
  logId: string,
  retentionCondition: SQL | undefined
): Promise<boolean> {
  const row = await currentLog(logId)
  const reference = (row.executionData as any)?.workflowArchive as ArchiveReference | undefined
  if (!reference)
    throw new Error('Verified archive handoff is required before SQL retention deletion')
  const artifact = await readPrivateArchive(reference)
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workflowExecutionLogs)
      .where(and(eq(workflowExecutionLogs.id, logId), retentionCondition))
      .limit(1)
      .for('update')
    if (!current) return false
    if (
      sourceFingerprint(current) !== artifact.sourceFingerprint ||
      (current.executionData as any)?.workflowArchive?.digest !== reference.digest
    )
      throw new ArchiveBusyError('Archived business source changed before SQL deletion')
    await assertNoConsumers(current, tx)
    for (const entry of artifact.nativeThreads as Array<{ reference: NativePayloadRef }>)
      scopedReference(entry.reference, current)
    // Even an empty native lookup would not prove that an earlier writer has settled.
    throw new ArchivePruneDeferredError()
  })
}

/** Preserve retained logs at the actual workspace cascade boundary, without inferring a native join. */
export async function assertWorkspaceArchiveDeletionInTx(
  tx: Pick<typeof db, 'execute' | 'select'>,
  workspaceId: string
): Promise<void> {
  if (process.env.WORKFLOW_ADMISSIONS_CLOSED !== 'true')
    throw new ArchiveBusyError('Close workflow admissions before deleting a workspace')
  const isolation = await tx.execute<{ transaction_isolation: unknown }>(
    sql`SHOW transaction_isolation`
  )
  if (isolation.length !== 1 || isolation[0]?.transaction_isolation !== 'read committed')
    throw new ArchiveBusyError('Workspace archive deletion requires a Read Committed transaction')
  const [parent] = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
    .for('update')
  if (!parent) throw new ArchiveBusyError('Workspace archive owner is unavailable')
  // A separate Read Committed statement sees a creator that committed before this parent lock.
  // Keep the lock through workspace DELETE so later log FK checks cannot race this predicate.
  const [retained] = await tx
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workspaceId, workspaceId))
    .limit(1)
  if (retained) throw new ArchivePruneDeferredError()
}

/** Exact prospective activation, shared by the future reader and the final SQL update. */
function preservedHistoricalRow(row: ExecutionLog, reference: ArchiveReference): ExecutionLog {
  const data = row.executionData as any
  const { traceSpans: _trace, tokenBreakdown: _tokens, models: _models, ...terminal } = data
  return {
    ...row,
    cost: null,
    executionData: {
      ...(row.endedAt ? terminal : data),
      preservedFunctionalArchive: reference,
      ...(row.endedAt ? { finalOutput: FUNCTIONAL_OUTPUT_REFERENCE } : {}),
    },
  }
}

/** No archive/hash-only success: exercise the SAME financial-gated job/result/webhook boundary. */
async function verifyHistoricalFutureReader(row: ExecutionLog, functional: { output?: unknown }) {
  const data = row.executionData as any
  const actor = data?.environment?.userId
  if (typeof actor !== 'string' || !actor)
    throw new ArchiveBusyError(
      'Original historical execution actor is unverified; keep source pinned'
    )
  if (!row.endedAt && (!data.pause || typeof data.pause !== 'object' || Array.isArray(data.pause)))
    throw new ArchiveBusyError(
      'Historical execution has no verified durable paused/terminal outcome; keep source pinned'
    )
  const scope = { workspaceId: row.workspaceId, executionId: row.executionId!, logId: row.id }
  const future = await readWorkflowExecutionResultFromLog(row, () =>
    assertRetainedLogAccess(scope, actor)
  )
  const expectedStatus = row.endedAt ? (row.level === 'error' ? 'failed' : 'completed') : 'paused'
  if (
    future.status !== expectedStatus ||
    !future.result ||
    (row.endedAt && functionalDigest(future.result.output) !== functionalDigest(functional.output))
  )
    throw new ArchiveBusyError(
      'Historical actual future-reader projection differs; keep original source pinned'
    )
  return actor
}

/** Bounded, explicit offline projector only; there is no old-format runtime reader. */
export async function preserveHistoricalWorkflowPayload(
  logId: string,
  protectSource: (source: { record: ExecutionLog; snapshot: unknown }) => Promise<void>
): Promise<ArchiveReference> {
  if (process.env.WORKFLOW_ADMISSIONS_CLOSED !== 'true')
    throw new Error('Historical preservation requires closed admissions and operational quiescence')
  const row = await currentLog(logId)
  const data = row.executionData as any
  const existingReference = data.preservedFunctionalArchive as ArchiveReference | undefined
  if (!existingReference && data.functionalPayload)
    throw new Error('Current native payload does not require historical projection')
  if (!existingReference && !Array.isArray(data.traceSpans))
    throw new Error('Classify missing historical functional payload before preservation')
  const [snapshot] = await db
    .select()
    .from(workflowExecutionSnapshots)
    .where(
      and(
        eq(workflowExecutionSnapshots.id, row.stateSnapshotId),
        eq(workflowExecutionSnapshots.workspaceId, row.workspaceId)
      )
    )
    .limit(1)
  if (!snapshot) throw new Error('Historical source graph is missing; keep source pinned')
  if (data.checkpoint) {
    const { decrypted } = await decryptSecret(data.checkpoint.encryptedSnapshot)
    const checkpoint = JSON.parse(decrypted) as WorkflowCheckpointSnapshot
    if (
      checkpoint.workflowLogId !== row.id ||
      checkpoint.blueprint?.workflowId !== row.workflowId ||
      !checkpoint.executor?.context
    )
      throw new ArchiveBusyError('Historical checkpoint scope is unverified; keep original pinned')
    const restored = restoreExecutionContext(checkpoint.executor.context)
    if (
      functionalDigest(JSON.parse(JSON.stringify(saveExecutionContext(restored)))) !==
      functionalDigest(checkpoint.executor.context)
    )
      throw new ArchiveBusyError(
        'Historical checkpoint structural restoration is unverified; keep original pinned'
      )
  }
  const source = sourceFingerprint(row)
  if (existingReference) {
    const artifact = await readPrivateArchive(existingReference)
    if (
      existingReference.workspaceId !== row.workspaceId ||
      existingReference.executionId !== row.executionId ||
      existingReference.logId !== row.id ||
      functionalDigest(artifact.record) !== functionalDigest(retainedBusinessRecord(row)) ||
      functionalDigest(artifact.snapshot) !== functionalDigest(snapshot)
    )
      throw new ArchiveBusyError(
        'Historical preserved artifact/owner/snapshot differs; keep source pinned'
      )
    const actor = await verifyHistoricalFutureReader(row, artifact.functional)
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.id, logId))
        .limit(1)
        .for('update')
      if (!current || sourceFingerprint(current) !== source)
        throw new ArchiveBusyError(
          'Historical source revision changed during future readback; keep original pinned'
        )
      if (!(await checkWorkspaceAccess(current.workspaceId, actor, tx)).hasAccess)
        throw new ArchiveBusyError(
          'Historical execution actor access was revoked; keep source pinned'
        )
    })
    return existingReference
  }
  const functional = projectHistoricalFunctionalPayload(data.traceSpans, data.finalOutput)
  await protectSource({ record: row, snapshot })
  const artifact = {
    record: retainedBusinessRecord(row),
    snapshot,
    functional,
    nativeThreads: [],
    sourceFingerprint: source,
  }
  const reference = await writePrivateArchive(
    { workspaceId: row.workspaceId, executionId: row.executionId!, logId: row.id },
    artifact
  )
  const readback = await readPrivateArchive(reference)
  if (
    functionalDigest(readback.functional) !== functionalDigest(functional) ||
    functionalDigest(readback.snapshot) !== functionalDigest(snapshot) ||
    functionalDigest(readback.record) !== functionalDigest(artifact.record)
  )
    throw new Error('Historical future-reader projection differs')
  const prospective = preservedHistoricalRow(row, reference)
  const actor = await verifyHistoricalFutureReader(prospective, functional)
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, logId))
      .limit(1)
      .for('update')
    if (!current || sourceFingerprint(current) !== source)
      throw new Error('Historical source revision changed; preserve original')
    if (!(await checkWorkspaceAccess(current.workspaceId, actor, tx)).hasAccess)
      throw new ArchiveBusyError(
        'Historical execution actor access was revoked; keep source pinned'
      )
    await tx
      .update(workflowExecutionLogs)
      .set({ cost: prospective.cost, executionData: prospective.executionData })
      .where(eq(workflowExecutionLogs.id, logId))
  })
  return reference
}

/** Workspace deletion cannot infer model/tool/queue quiescence from Yjs or a terminal native snapshot. */
export async function prepareWorkspaceArchiveDeletion(workspaceId: string): Promise<void> {
  if (process.env.WORKFLOW_ADMISSIONS_CLOSED !== 'true')
    throw new ArchiveBusyError(
      'Close execution admissions and establish scoped operational quiescence before deleting retained workflow payloads'
    )
  for (;;) {
    const logs = await db
      .select({ id: workflowExecutionLogs.id })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workspaceId, workspaceId),
          sql`${workflowExecutionLogs.executionData}->'workflowArchive' IS NULL`
        )
      )
      .limit(50)
    if (!logs.length) break
    for (const log of logs) await prepareWorkflowArchive(log.id)
  }
  for (let offset = 0; ; offset += 50) {
    const logs = await db
      .select({ id: workflowExecutionLogs.id })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.workspaceId, workspaceId))
      .orderBy(workflowExecutionLogs.id)
      .limit(50)
      .offset(offset)
    for (const log of logs) await pruneArchivedWorkflowPayload(log.id)
    if (logs.length < 50) break
  }
}
