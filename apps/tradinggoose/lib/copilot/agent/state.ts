import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { CopilotToolContext, Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { getAgentMemory, getNativeWorkflowsStore } from '@/lib/mastra/runtime'

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

async function insertReceipt(id: string, value: unknown, identifier: string) {
  const now = new Date()
  const rows = await db
    .insert(verification)
    .values({
      id,
      identifier,
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
  if (
    !(await insertReceipt(
      receiptId('run', run.runId),
      run,
      receiptId('thread', [run.scope, run.threadId])
    ))
  )
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

export async function claimCopilotThread(scope: Scope, threadId: string, runId: string) {
  if (
    !(await insertReceipt(
      receiptId('thread', [scope, threadId]),
      { runId },
      receiptId('thread', [scope, threadId])
    ))
  )
    throw new NativeTargetError(
      'This conversation has an unfinished turn. Stop it, or start a new conversation if it was interrupted.',
      409
    )
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

export async function cancelCopilotRun(runId: string) {
  await insertReceipt(receiptId('cancel', runId), true, await runReceiptOwner(runId))
}

export async function assertCopilotRunActive(runId: string) {
  if (await isCopilotRunCancelled(runId))
    throw new NativeTargetError('Copilot generation was cancelled; completed effects remain', 409)
}

export async function isCopilotRunCancelled(runId: string) {
  return Boolean(await readReceipt(receiptId('cancel', runId)))
}

async function runReceiptOwner(runId: string) {
  const run = await readReceipt<CopilotRun>(receiptId('run', runId))
  if (!run) throw new NativeTargetError('Copilot run is unavailable', 409)
  return receiptId('thread', [run.scope, run.threadId])
}

/** Mastra stores outcomes. This claim prevents repeating an effect after an uncertain interruption. */
export async function runCopilotEffectOnce<T>(
  runId: string,
  toolCallId: string,
  phase: string,
  input: unknown,
  execute: () => Promise<T>
): Promise<T> {
  if (
    !(await insertReceipt(
      receiptId('effect', [runId, toolCallId, phase]),
      { fingerprint: receiptId('input', input) },
      await runReceiptOwner(runId)
    ))
  )
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  await assertCopilotRunActive(runId)
  return execute()
}

/** Delete the native conversation and all application claims together under its mutation claim. */
export async function deleteCopilotThread(scope: Scope, threadId: string) {
  const mutationId = crypto.randomUUID()
  await claimCopilotThread(scope, threadId, mutationId)
  try {
    const owner = receiptId('thread', [scope, threadId])
    const receipts = await db
      .select({ id: verification.id, value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, owner))
    const workflows = await getNativeWorkflowsStore()
    for (const receipt of receipts) {
      if (!receipt.id.startsWith('copilot:run:')) continue
      const run = JSON.parse(receipt.value) as CopilotRun
      if (
        run.threadId !== threadId ||
        stableStringifyJsonValue(run.scope) !== stableStringifyJsonValue(scope)
      )
        throw new NativeTargetError('Stored Copilot conversation ownership differs', 403)
      let snapshot = await workflows.getWorkflowRunById({ runId: run.runId })
      while (snapshot) {
        await workflows.deleteWorkflowRunById({
          runId: run.runId,
          workflowName: snapshot.workflowName,
        })
        snapshot = await workflows.getWorkflowRunById({ runId: run.runId })
      }
    }
    await db
      .delete(verification)
      .where(and(eq(verification.identifier, owner), ne(verification.id, owner)))
    await (await getAgentMemory()).deleteThread(threadId)
  } finally {
    await releaseCopilotThread(scope, threadId, mutationId)
  }
}

/** Browser effect routes claim before dispatch; authoritative readback supplies their result. */
export async function claimCopilotBrowserEffect(runId: string, toolCallId: string, input: unknown) {
  const id = receiptId('effect', [runId, toolCallId, 'browser'])
  if (
    !(await insertReceipt(
      id,
      { fingerprint: receiptId('input', input) },
      await runReceiptOwner(runId)
    ))
  )
    throw new NativeTargetError('This Copilot browser action was already dispatched', 409)
  await assertCopilotRunActive(runId)
}
