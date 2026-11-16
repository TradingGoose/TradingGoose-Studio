import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { RunFenceConflictError, type RunFenceScope, setRunFenceContext } from '@mastra/core/storage'
import { runs } from '@trigger.dev/sdk'
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
import { getNativeMemoryStore, getNativeWorkflowsStore } from '@/lib/mastra/runtime'

export interface CopilotRun {
  runId: string
  threadId: string
  scope: Scope
  model: string
  providerOptions?: Extract<CopilotRequest, { command: 'message' }>['providerOptions']
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
