import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { RunFenceConflictError, type RunFenceScope, setRunFenceContext } from '@mastra/core/storage'
import { db } from '@tradinggoose/db'
import { verification } from '@tradinggoose/db/schema'
import { runs } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type {
  CopilotRequest,
  CopilotToolContext,
  SafeError,
  Scope,
} from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import {
  deleteNativeThread,
  getCopilotAgent,
  getNativeMemoryStore,
  getNativeWorkflowsStore,
} from '@/lib/mastra/runtime'

export interface CopilotRun {
  runId: string
  threadId: string
  scope: Scope
  model: string
  accessLevel: CopilotAccessLevel
  toolContext?: CopilotToolContext
  toolContexts?: CopilotToolContext[]
}

export interface CopilotJobState {
  id: string
  runId: string
  triggerRunId?: string
  admissionGeneration?: number
  status?: 'success' | 'suspended' | 'failed' | 'aborted'
  error?: SafeError
}

export async function readCopilotJob(scope: Scope, threadId: string) {
  const thread = await (await getNativeMemoryStore()).getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  return thread?.metadata?.copilotJob as CopilotJobState | undefined
}

export async function isCopilotJobActive(job: CopilotJobState) {
  // Admission holds native ownership until the Trigger handle is saved.
  return !job.status && job.triggerRunId
    ? !(await runs.retrieve(job.triggerRunId)).isCompleted
    : false
}

// Admission, cancellation and effect receipts prevent replay after an uncertain interruption.
const receiptId = (kind: string, key: unknown) =>
  `copilot:${kind}:${createHash('sha256').update(stableStringifyJsonValue(key)).digest('hex')}`
const expiresAt = new Date('9999-12-31T00:00:00.000Z')
const THREAD_LEASE_MS = 15_000
// Use Mastra's run-fence context so its native writes inherit the thread claim.
const fenceScope = new AsyncLocalStorage<RunFenceScope | undefined>()
const fenceContext = setRunFenceContext({
  current: () => fenceScope.getStore(),
  run: (scope, operation) => fenceScope.run(scope, operation),
})

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

export async function readCopilotThreadOwnership(scope: Scope, threadId: string) {
  return (await getNativeWorkflowsStore()).getRunOwnership({
    runId: receiptId('thread', [scope, threadId]),
  })
}

export async function readCopilotThreadRun(scope: Scope, threadId: string) {
  const owner = await readCopilotThreadOwnership(scope, threadId)
  if (owner?.live) return owner.ownerId
  const job = await readCopilotJob(scope, threadId)
  if (job && (await isCopilotJobActive(job))) return job.runId
  const { runs } = await (await getCopilotAgent()).listSuspendedRuns({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  for (const run of runs) {
    if (!(await isCopilotRunCancelled(run.runId))) return run.runId
  }
}

export async function claimCopilotThread(
  scope: Scope,
  threadId: string,
  runId: string,
  jobId?: string,
  expectedGeneration?: number
) {
  const [workflows, memory] = await Promise.all([getNativeWorkflowsStore(), getNativeMemoryStore()])
  let leaseDeadline = performance.now() + THREAD_LEASE_MS
  const claim = await workflows.claimRunOwnership({
    runId: receiptId('thread', [scope, threadId]),
    ownerId: runId,
    leaseMs: THREAD_LEASE_MS,
    ...(expectedGeneration === undefined ? {} : { force: true, expectedGeneration }),
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
  try {
    const job = await readCopilotJob(scope, threadId)
    if (jobId ? job?.id !== jobId : job && (await isCopilotJobActive(job)))
      throw new NativeTargetError('This conversation has another active response', 409)
    // Advance the thread's native memory fence before admitting its next writer.
    if (!(await memory.raiseRunFence(fence)))
      throw new RunFenceConflictError(fence, 'claimCopilotThread')
  } catch (error) {
    await workflows.releaseRunOwnership(fence)
    throw error
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
  const handoff = async () => {
    clearInterval(timer)
    await renewal?.catch(() => {})
  }
  return {
    fence,
    run<T>(operation: () => T): T {
      return fenceContext.run(
        {
          fenceFor: (store) => (store === memory || store === workflows ? fence : undefined),
          onConflict: () =>
            cancellation.abort(
              new NativeTargetError('This Copilot turn no longer owns the conversation', 409)
            ),
        },
        operation
      )
    },
    signal: cancellation.signal,
    renew,
    handoff,
    async release() {
      await handoff()
      try {
        await memory.retireRunFence(fence)
      } finally {
        await workflows.releaseRunOwnership(fence)
      }
    },
  }
}

type ScopedRun = Pick<CopilotRun, 'runId' | 'threadId' | 'scope'>

const runOwner = (run: ScopedRun) => receiptId('thread', [run.scope, run.threadId])

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

export async function cancelCopilotRun(run: ScopedRun) {
  await insertReceipt(receiptId('cancel', run.runId), runOwner(run))
}

export async function assertCopilotRunActive(runId: string) {
  if (await isCopilotRunCancelled(runId))
    throw new NativeTargetError('Copilot generation was cancelled; completed effects remain', 409)
}

export async function isCopilotRunCancelled(runId: string) {
  const [row] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.id, receiptId('cancel', runId)))
    .limit(1)
  return Boolean(row)
}

/** Mastra stores outcomes. This claim prevents repeating an effect after an uncertain interruption. */
export async function claimCopilotEffect(
  run: ScopedRun,
  toolCallId: string,
  phase: 'execute' | 'review' | 'browser',
  store: Pick<typeof db, 'insert'> = db
) {
  if (
    !(await insertReceipt(
      receiptId('effect', [run.runId, toolCallId, phase]),
      runOwner(run),
      'true',
      store
    ))
  )
    throw new NativeTargetError(
      'This Copilot action was already dispatched; verify its result before continuing',
      409
    )
  await assertCopilotRunActive(run.runId)
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
  const job = await readCopilotJob(scope, threadId)
  const owner = await readCopilotThreadOwnership(scope, threadId)
  if (job && !job.status && job.runId !== owner?.ownerId && !(await isCopilotJobActive(job)))
    await cancelCopilotRun({ runId: job.runId, threadId, scope })
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
    await assertCopilotThreadReady(scope, threadId)
    await deleteNativeThread(threadId, claim.fence, (transaction) =>
      transaction.none('DELETE FROM "public"."verification" WHERE identifier = $1', [
        claim.fence.runId,
      ])
    )
  } finally {
    await claim.release()
  }
}
