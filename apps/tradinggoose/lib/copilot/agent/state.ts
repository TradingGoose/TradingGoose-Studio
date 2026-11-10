import { createHash } from 'node:crypto'
import type { FinancialBinding, ModelOccurrence } from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { CopilotToolContext, Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { stableStringifyJsonValue } from '@/lib/json/stable'

export interface CopilotRun {
  runId: string
  threadId: string
  scope: Scope
  model: string
  accessLevel: CopilotAccessLevel
  toolContext?: Pick<
    ServerToolExecutionContext,
    'workspaceId' | 'contextEntityKind' | 'contextEntityId'
  >
  toolContexts?: CopilotToolContext[]
  workflowId?: string
  binding: FinancialBinding
  occurrence?: ModelOccurrence
}

// These are authorization context and one-shot effect receipts, never conversation history.
// Primary keys make claims atomic across Studio processes. Unknown outcomes stay claimed.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')

async function readReceipt<T>(id: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.id, id))
    .limit(1)
  return row ? (JSON.parse(row.value) as T) : undefined
}

async function insertReceipt(id: string, value: unknown) {
  const now = new Date()
  const rows = await db
    .insert(verification)
    .values({
      id,
      identifier: id,
      value: JSON.stringify(value),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: verification.id })
    .returning({ id: verification.id })
  return rows.length === 1
}

export async function saveCopilotRun(run: CopilotRun) {
  if (!(await insertReceipt(receiptId('run', run.runId), run)))
    throw new NativeTargetError('Copilot run already exists', 409)
}

export async function readCopilotRun(scope: Scope, runId: string): Promise<CopilotRun> {
  const run = await readReceipt<CopilotRun>(receiptId('run', runId))
  if (
    !run ||
    run.runId !== runId ||
    stableStringifyJsonValue(run.scope) !== stableStringifyJsonValue(scope)
  )
    throw new NativeTargetError('Copilot run is unavailable in this conversation scope', 403)
  return run
}

export async function saveCopilotOccurrence(run: CopilotRun, occurrence: ModelOccurrence) {
  run.occurrence = occurrence
  await db
    .update(verification)
    .set({ value: JSON.stringify(run), updatedAt: new Date() })
    .where(eq(verification.id, receiptId('run', run.runId)))
}

export async function claimCopilotThread(scope: Scope, threadId: string, runId: string) {
  if (!(await insertReceipt(receiptId('thread', [scope, threadId]), { runId })))
    throw new NativeTargetError('Finish or cancel the current Copilot turn first', 409)
}

export async function releaseCopilotThread(scope: Scope, threadId: string, runId: string) {
  await db
    .delete(verification)
    .where(
      and(
        eq(verification.id, receiptId('thread', [scope, threadId])),
        eq(verification.value, JSON.stringify({ runId }))
      )
    )
}

export async function assertCopilotThreadIdle(scope: Scope, threadId: string) {
  if (await readReceipt(receiptId('thread', [scope, threadId])))
    throw new NativeTargetError('Finish or cancel the current Copilot turn first', 409)
}

export async function cancelCopilotRun(runId: string) {
  await insertReceipt(receiptId('cancel', runId), true)
}

export async function assertCopilotRunActive(runId: string) {
  if (await isCopilotRunCancelled(runId))
    throw new NativeTargetError('Copilot generation was cancelled; completed effects remain', 409)
}

export async function isCopilotRunCancelled(runId: string) {
  return Boolean(await readReceipt(receiptId('cancel', runId)))
}

export async function runCopilotEffectOnce<T>(
  runId: string,
  toolCallId: string,
  phase: string,
  input: unknown,
  execute: () => Promise<T>
): Promise<T> {
  const id = receiptId('effect', [runId, toolCallId, phase])
  const fingerprint = stableStringifyJsonValue(input)
  const claimed = { fingerprint, state: 'claimed' as const }
  if (!(await insertReceipt(id, claimed))) {
    const previous = await readReceipt<{ fingerprint: string; state: string; result?: T }>(id)
    if (previous?.fingerprint !== fingerprint)
      throw new NativeTargetError(
        'This Copilot action was already claimed with different input',
        409
      )
    if (previous.state === 'completed') return previous.result as T
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  }
  await assertCopilotRunActive(runId)
  const result = await execute()
  const rows = await db
    .update(verification)
    .set({
      value: JSON.stringify({ fingerprint, state: 'completed', result }),
      updatedAt: new Date(),
    })
    .where(and(eq(verification.id, id), eq(verification.value, JSON.stringify(claimed))))
    .returning({ id: verification.id })
  if (!rows.length)
    throw new NativeTargetError(
      'Copilot effect acknowledgement is unavailable; do not repeat the action',
      409
    )
  return result
}

/** Browser effect routes claim before dispatch; authoritative readback supplies their result. */
export async function claimCopilotBrowserEffect(runId: string, toolCallId: string, input: unknown) {
  const id = receiptId('effect', [runId, toolCallId, 'browser'])
  if (
    !(await insertReceipt(id, { fingerprint: stableStringifyJsonValue(input), state: 'claimed' }))
  )
    throw new NativeTargetError('This Copilot browser action was already dispatched', 409)
  await assertCopilotRunActive(runId)
}
