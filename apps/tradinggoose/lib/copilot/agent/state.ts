import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { CopilotToolContext, Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { getAgentMemory, getCopilotAgent, getNativeWorkflowsStore } from '@/lib/mastra/runtime'

export interface CopilotRun {
  runId: string
  threadId: string
  scope: Scope
  model: string
  accessLevel: CopilotAccessLevel
  toolContext?: CopilotToolContext
  toolContexts?: CopilotToolContext[]
  workflowId?: string
}

// These are atomic mutation, cancellation and effect claims, never conversation history.
// Primary keys make claims atomic across Studio processes. Unknown outcomes stay claimed.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')
type ThreadPhase = 'active' | 'suspended'

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

export async function readCopilotThreadRun(scope: Scope, threadId: string) {
  return (await readReceipt<{ runId: string }>(receiptId('thread', [scope, threadId])))?.runId
}

export async function claimCopilotThread(scope: Scope, threadId: string, runId: string) {
  if (
    !(await insertReceipt(
      receiptId('thread', [scope, threadId]),
      { runId, phase: 'active' },
      receiptId('thread', [scope, threadId])
    ))
  )
    throw new NativeTargetError(
      'This conversation has an unfinished turn. Stop it, or start a new conversation if it was interrupted.',
      409
    )
}

export async function releaseCopilotThread(
  scope: Scope,
  threadId: string,
  runId: string,
  phase: ThreadPhase = 'active'
) {
  await db
    .delete(verification)
    .where(
      and(
        eq(verification.id, receiptId('thread', [scope, threadId])),
        eq(verification.value, JSON.stringify({ runId, phase }))
      )
    )
}

async function transitionCopilotThread(
  scope: Scope,
  threadId: string,
  runId: string,
  from: ThreadPhase,
  phase: ThreadPhase
) {
  const rows = await db
    .update(verification)
    .set({ value: JSON.stringify({ runId, phase }), updatedAt: new Date() })
    .where(
      and(
        eq(verification.id, receiptId('thread', [scope, threadId])),
        eq(verification.value, JSON.stringify({ runId, phase: from }))
      )
    )
    .returning({ id: verification.id })
  if (rows.length !== 1)
    throw new NativeTargetError('This Copilot turn is already running or cancelled', 409)
}

export async function resumeCopilotThread(scope: Scope, threadId: string, runId: string) {
  await transitionCopilotThread(scope, threadId, runId, 'suspended', 'active')
}

export async function suspendCopilotThread(scope: Scope, threadId: string, runId: string) {
  await transitionCopilotThread(scope, threadId, runId, 'active', 'suspended')
  if (await isCopilotRunCancelled(runId))
    await releaseCopilotThread(scope, threadId, runId, 'suspended')
}

type ScopedRun = Pick<CopilotRun, 'runId' | 'threadId' | 'scope'>

const runOwner = (run: ScopedRun) => receiptId('thread', [run.scope, run.threadId])

export async function cancelCopilotRun(run: ScopedRun) {
  await insertReceipt(receiptId('cancel', run.runId), true, runOwner(run))
  await releaseCopilotThread(run.scope, run.threadId, run.runId, 'suspended')
}

export async function assertCopilotRunActive(runId: string) {
  if (await isCopilotRunCancelled(runId))
    throw new NativeTargetError('Copilot generation was cancelled; completed effects remain', 409)
}

export async function isCopilotRunCancelled(runId: string) {
  return Boolean(await readReceipt(receiptId('cancel', runId)))
}

/** Mastra stores outcomes. This claim prevents repeating an effect after an uncertain interruption. */
export async function runCopilotEffectOnce<T>(
  run: ScopedRun,
  toolCallId: string,
  phase: string,
  execute: () => Promise<T>
): Promise<T> {
  if (
    !(await insertReceipt(receiptId('effect', [run.runId, toolCallId, phase]), true, runOwner(run)))
  )
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  await assertCopilotRunActive(run.runId)
  return execute()
}

/** Delete the native conversation and all application claims together under its mutation claim. */
export async function deleteCopilotThread(scope: Scope, threadId: string) {
  const mutationId = crypto.randomUUID()
  await claimCopilotThread(scope, threadId, mutationId)
  try {
    const owner = receiptId('thread', [scope, threadId])
    const { runs } = await (await getCopilotAgent()).listSuspendedRuns({
      threadId,
      resourceId: nativeConversationIdentity(scope).resourceId,
    })
    const workflows = await getNativeWorkflowsStore()
    for (const run of runs) {
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
export async function claimCopilotBrowserEffect(run: ScopedRun, toolCallId: string) {
  const id = receiptId('effect', [run.runId, toolCallId, 'browser'])
  if (!(await insertReceipt(id, true, runOwner(run))))
    throw new NativeTargetError('This Copilot browser action was already dispatched', 409)
  await assertCopilotRunActive(run.runId)
}
