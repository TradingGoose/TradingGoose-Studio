import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
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

// Cancellation and effect receipts prevent replay after an uncertain interruption.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')
const THREAD_LEASE_MS = 15_000

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

export async function readCopilotThreadOwnership(scope: Scope, threadId: string) {
  return (await getNativeWorkflowsStore()).getRunOwnership({
    runId: receiptId('thread', [scope, threadId]),
  })
}

export async function readCopilotThreadRun(scope: Scope, threadId: string) {
  const owner = await readCopilotThreadOwnership(scope, threadId)
  if (owner?.live) return owner.ownerId
  const { runs } = await (await getCopilotAgent()).listSuspendedRuns({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  for (const run of runs) {
    if (!(await isCopilotRunCancelled(run.runId))) return run.runId
  }
}

export async function claimCopilotThread(scope: Scope, threadId: string, runId: string) {
  const workflows = await getNativeWorkflowsStore()
  let leaseDeadline = performance.now() + THREAD_LEASE_MS
  const claim = await workflows.claimRunOwnership({
    runId: receiptId('thread', [scope, threadId]),
    ownerId: runId,
    leaseMs: THREAD_LEASE_MS,
  })
  if (!claim.acquired)
    throw new NativeTargetError(
      'This conversation is still running. Stop it or wait for it to finish.',
      409
    )
  const { generation, ownerId } = claim.record
  const fence = { runId: claim.record.runId, generation, ownerId }
  const cancellation = new AbortController()
  const withinLease = async <T>(operation: Promise<T>) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new NativeTargetError('Copilot conversation ownership expired', 409)),
            Math.max(0, leaseDeadline - performance.now())
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
  let renewal: Promise<void> | undefined
  const renew = async () => {
    cancellation.signal.throwIfAborted()
    const started = performance.now()
    return (renewal ??= withinLease(
      workflows.renewRunOwnership({ ...fence, leaseMs: THREAD_LEASE_MS })
    )
      .then((result) => {
        if (!result.renewed)
          throw new NativeTargetError('This Copilot turn no longer owns the conversation', 409)
        leaseDeadline = started + THREAD_LEASE_MS
      })
      .catch((error) => {
        cancellation.abort(error)
        throw error
      })
      .finally(() => {
        renewal = undefined
      }))
  }
  const timer = setInterval(() => void renew().catch(() => {}), THREAD_LEASE_MS / 3)
  timer.unref?.()
  return {
    signal: cancellation.signal,
    renew,
    async release() {
      clearInterval(timer)
      await renewal?.catch(() => {})
      await withinLease(workflows.releaseRunOwnership(fence))
    },
  }
}

type ScopedRun = Pick<CopilotRun, 'runId' | 'threadId' | 'scope'>

const runOwner = (run: ScopedRun) => receiptId('thread', [run.scope, run.threadId])

export async function cancelCopilotRun(run: ScopedRun) {
  await insertReceipt(receiptId('cancel', run.runId), true, runOwner(run))
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

export async function deleteCopilotRunSnapshot(runId: string) {
  const workflows = await getNativeWorkflowsStore()
  let snapshot = await workflows.getWorkflowRunById({ runId })
  while (snapshot) {
    await workflows.deleteWorkflowRunById({ runId, workflowName: snapshot.workflowName })
    snapshot = await workflows.getWorkflowRunById({ runId })
  }
}

/** Check suspensions under thread ownership before a new turn or deletion. */
export async function assertCopilotThreadReady(scope: Scope, threadId: string) {
  const { runs } = await (await getCopilotAgent()).listSuspendedRuns({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  for (const run of runs) {
    if (!(await isCopilotRunCancelled(run.runId)))
      throw new NativeTargetError('Resolve the pending tool or stop this response first', 409)
    await deleteCopilotRunSnapshot(run.runId)
  }
}

/** Delete the native conversation and its receipts while holding thread ownership. */
export async function deleteCopilotThread(scope: Scope, threadId: string) {
  const claim = await claimCopilotThread(scope, threadId, crypto.randomUUID())
  try {
    const owner = receiptId('thread', [scope, threadId])
    await assertCopilotThreadReady(scope, threadId)
    await claim.renew()
    await db.delete(verification).where(eq(verification.identifier, owner))
    await claim.renew()
    await (await getAgentMemory()).deleteThread(threadId)
  } finally {
    await claim.release()
  }
}

/** Browser effect routes claim before dispatch; authoritative readback supplies their result. */
export async function claimCopilotBrowserEffect(run: ScopedRun, toolCallId: string) {
  const id = receiptId('effect', [run.runId, toolCallId, 'browser'])
  if (!(await insertReceipt(id, true, runOwner(run))))
    throw new NativeTargetError('This Copilot browser action was already dispatched', 409)
  await assertCopilotRunActive(run.runId)
}
