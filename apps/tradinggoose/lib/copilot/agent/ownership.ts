import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  type RunFence,
  RunFenceConflictError,
  type RunFenceScope,
  setRunFenceContext,
  type WorkflowsStorage,
} from '@mastra/core/storage'
import { runs } from '@trigger.dev/sdk'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type {
  CopilotRequest,
  CopilotToolContext,
  SafeError,
  Scope,
  WorkflowObservation,
} from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import {
  getCopilotAgent,
  getNativeMemoryStore,
  getNativeWorkflowsStore,
} from '@/lib/mastra/runtime'

export interface CopilotRun {
  runId: string
  threadId: string
  scope: Scope
  model: string
  reasoning?: Extract<CopilotRequest, { command: 'message' }>['reasoning']
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
  readbackRequestId?: string
  workflowObservation?: WorkflowObservation
  error?: SafeError
}

export async function readCopilotJob(scope: Scope, threadId: string) {
  const thread = await (await getNativeMemoryStore()).getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  return thread?.metadata?.copilotJob as CopilotJobState | undefined
}

/** A failed readback does not settle the independent workflow that Stop may still need to cancel. */
export async function hasPendingWorkflowReadback(
  scope: Scope,
  threadId: string,
  job: CopilotJobState | undefined
) {
  if (!job?.readbackRequestId) return false
  const { runs } = await (await getCopilotAgent()).listSuspendedRuns({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  return runs.some(
    (run) =>
      run.runId === job.runId &&
      run.toolCalls.some((call) => call.toolName === 'run_workflow' && !call.requiresApproval)
  )
}

export async function isCopilotJobActive(job: CopilotJobState) {
  // Admission holds native ownership until the Trigger handle is saved.
  return !job.status && job.triggerRunId
    ? !(await runs.retrieve(job.triggerRunId)).isCompleted
    : false
}

export const copilotThreadOwnerId = (scope: Scope, threadId: string) =>
  `copilot:thread:${createHash('sha256')
    .update(stableStringifyJsonValue([scope, threadId]))
    .digest('hex')}`

export const THREAD_LEASE_MS = 15_000
// Use Mastra's run-fence context so its native writes inherit the thread claim.
const fenceScope = new AsyncLocalStorage<RunFenceScope | undefined>()
const fenceContext = setRunFenceContext({
  current: () => fenceScope.getStore(),
  run: (scope, operation) => fenceScope.run(scope, operation),
})

export async function readCopilotThreadOwnership(scope: Scope, threadId: string) {
  return (await getNativeWorkflowsStore()).getRunOwnership({
    runId: copilotThreadOwnerId(scope, threadId),
  })
}

export function maintainCopilotThreadLease(
  workflows: WorkflowsStorage,
  fence: RunFence,
  initialDeadline: number
) {
  let leaseDeadline = Math.min(initialDeadline, performance.now() + THREAD_LEASE_MS)
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
    if (started >= leaseDeadline) {
      cancellation.abort(new NativeTargetError('Copilot conversation ownership expired', 409))
      cancellation.signal.throwIfAborted()
    }
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
    signal: cancellation.signal,
    abort: (reason: unknown) => cancellation.abort(reason),
    renew,
    handoff,
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
  const leaseDeadline = performance.now() + THREAD_LEASE_MS
  const claim = await workflows.claimRunOwnership({
    runId: copilotThreadOwnerId(scope, threadId),
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
  const lease = maintainCopilotThreadLease(workflows, fence, leaseDeadline)
  return {
    fence,
    run<T>(operation: () => T): T {
      return fenceContext.run(
        {
          fenceFor: (store) => (store === memory || store === workflows ? fence : undefined),
          onConflict: () =>
            lease.abort(
              new NativeTargetError('This Copilot turn no longer owns the conversation', 409)
            ),
        },
        operation
      )
    },
    signal: lease.signal,
    renew: lease.renew,
    handoff: lease.handoff,
    async release() {
      await lease.handoff()
      try {
        await memory.retireRunFence(fence)
      } finally {
        await workflows.releaseRunOwnership(fence)
      }
    },
  }
}

export async function saveCopilotJob(
  scope: Scope,
  threadId: string,
  jobId: string,
  update: Partial<CopilotJobState>
) {
  const store = await getNativeMemoryStore()
  const thread = await store.getThreadById({
    threadId,
    resourceId: nativeConversationIdentity(scope).resourceId,
  })
  const job = thread?.metadata?.copilotJob as CopilotJobState | undefined
  if (!job || job.id !== jobId) throw new NativeTargetError('This Copilot turn has changed', 409)
  await store.updateThread({
    id: threadId,
    metadata: { ...thread!.metadata, copilotJob: { ...job, ...update } },
  })
}

export async function deleteCopilotRunSnapshot(runId: string) {
  const workflows = await getNativeWorkflowsStore()
  let snapshot = await workflows.getWorkflowRunById({ runId })
  while (snapshot) {
    await workflows.deleteWorkflowRunById({ runId, workflowName: snapshot.workflowName })
    snapshot = await workflows.getWorkflowRunById({ runId })
  }
}

/** Admission and lifecycle cleanup wait for the current native writer to settle. */
export async function waitForCopilotRunRelease(
  scope: Scope,
  threadId: string,
  runId: string,
  signal: AbortSignal
) {
  while (true) {
    const owner = await readCopilotThreadOwnership(scope, threadId)
    if (!owner?.live || owner.ownerId !== runId) break
    signal.throwIfAborted()
    await delay(500, undefined, { signal })
  }
  signal.throwIfAborted()
}
