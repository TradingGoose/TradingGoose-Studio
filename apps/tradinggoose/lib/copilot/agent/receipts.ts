import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { CopilotRequest } from '@/lib/copilot/native/contract'
import { CopilotRunCancelled, NativeTargetError } from '@/lib/copilot/native/errors'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { type CopilotRun, copilotThreadOwnerId } from './ownership'

// Durable admission, cancellation and effect receipts prevent replay after interruption.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')

async function insertReceipt(
  id: string,
  identifier: string,
  value = 'true',
  store: Pick<typeof db, 'insert'> = db
) {
  const now = new Date()
  const rows = await store
    .insert(verification)
    .values({
      id,
      identifier,
      value,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: verification.id })
    .returning({ id: verification.id })
  return rows.length === 1
}

type ScopedRun = Pick<CopilotRun, 'runId' | 'threadId' | 'scope'>
type EffectPhase = 'execute' | 'review' | 'browser'

const runOwner = (run: ScopedRun) => copilotThreadOwnerId(run.scope, run.threadId)
const effectReceiptId = (run: ScopedRun, toolCallId: string, phase: EffectPhase) =>
  receiptId('effect', [run.runId, toolCallId, phase])

export async function readCopilotAdmission(
  run: ScopedRun,
  request: CopilotRequest & { requestId: string }
) {
  const [receipt] = await db
    .select({ identifier: verification.identifier, value: verification.value })
    .from(verification)
    .where(eq(verification.id, receiptId('admission', [run.scope, request.requestId])))
    .limit(1)
  if (!receipt) return false
  if (receipt.identifier !== runOwner(run) || receipt.value !== receiptId('request', request))
    throw new NativeTargetError('This Copilot request ID already belongs to another command', 409)
  return true
}

export async function claimCopilotAdmission(
  run: ScopedRun,
  request: CopilotRequest & { requestId: string }
) {
  if (
    !(await insertReceipt(
      receiptId('admission', [run.scope, request.requestId]),
      runOwner(run),
      receiptId('request', request)
    ))
  )
    throw new NativeTargetError('This Copilot request was already admitted', 409)
}

export async function cancelCopilotRun(
  run: ScopedRun,
  store: Pick<typeof db, 'insert'> = db,
  value: 'true' | 'draining' = 'true'
) {
  await insertReceipt(receiptId('cancel', run.runId), runOwner(run), value, store)
}

export async function assertCopilotRunActive(runId: string, store: Pick<typeof db, 'select'> = db) {
  if (await isCopilotRunCancelled(runId, store)) throw new CopilotRunCancelled()
}

export async function readCopilotCancellation(
  runId: string,
  store: Pick<typeof db, 'select'> = db
) {
  const [row] = await store
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.id, receiptId('cancel', runId)))
    .limit(1)
  if (!row) return
  return row.value === 'draining' ? 'draining' : 'settled'
}

export async function isCopilotRunCancelled(runId: string, store: Pick<typeof db, 'select'> = db) {
  return Boolean(await readCopilotCancellation(runId, store))
}

export async function finishCopilotWorkflowCancellation(run: ScopedRun) {
  await db
    .update(verification)
    .set({ value: 'true', updatedAt: new Date() })
    .where(
      and(
        eq(verification.id, receiptId('cancel', run.runId)),
        eq(verification.identifier, runOwner(run)),
        eq(verification.value, 'draining')
      )
    )
}

/** Mastra stores outcomes. This claim prevents repeating an effect after an uncertain interruption. */
export async function claimCopilotEffect(
  run: ScopedRun,
  toolCallId: string,
  phase: EffectPhase,
  store: Pick<typeof db, 'insert' | 'select'> = db,
  value = 'true'
) {
  if (!(await insertReceipt(effectReceiptId(run, toolCallId, phase), runOwner(run), value, store)))
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  await assertCopilotRunActive(run.runId, store)
}

const WORKFLOW_ADMISSION_LOCK_NAMESPACE = 29_404
function lockWorkflowAdmissions(runId: string, tx: Pick<typeof db, 'execute'>) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(${WORKFLOW_ADMISSION_LOCK_NAMESPACE}, hashtext(${runId}))`
  )
}

export async function claimCopilotWorkflowAdmission(
  run: ScopedRun,
  toolCallId: string,
  tx: Pick<typeof db, 'execute' | 'insert' | 'select'>
) {
  await lockWorkflowAdmissions(run.runId, tx)
  await claimCopilotEffect(run, toolCallId, 'browser', tx, run.runId)
}

/** Check native suspensions outside the queue transaction, then fence any newly admitted calls. */
export async function cancelCopilotRunAfterWorkflows(
  run: ScopedRun,
  signalWorkflows: (isAdmitted: (toolCallId: string) => boolean) => Promise<boolean | undefined>
) {
  const checked = new Set<string>()
  let draining = false
  for (;;) {
    const remaining = await db.transaction(async (tx) => {
      await lockWorkflowAdmissions(run.runId, tx)
      const receipts = await tx
        .select({ id: verification.id })
        .from(verification)
        .where(and(eq(verification.identifier, runOwner(run)), eq(verification.value, run.runId)))
      const ids = new Set(receipts.map(({ id }) => id).filter((id) => !checked.has(id)))
      if (!ids.size) await cancelCopilotRun(run, tx, draining ? 'draining' : 'true')
      return ids
    })
    if (!remaining.size) return
    if (await signalWorkflows((callId) => remaining.has(effectReceiptId(run, callId, 'browser'))))
      draining = true
    for (const id of remaining) checked.add(id)
  }
}
