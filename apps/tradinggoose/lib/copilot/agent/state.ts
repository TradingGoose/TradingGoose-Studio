import type { Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { deleteNativeThread, getCopilotAgent } from '@/lib/mastra/runtime'
import {
  claimCopilotThread,
  deleteCopilotRunSnapshot,
  isCopilotJobActive,
  readCopilotJob,
  readCopilotThreadOwnership,
} from './ownership'
import { cancelCopilotRun, isCopilotRunCancelled } from './receipts'

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
