import { task, timeout } from '@trigger.dev/sdk'
import type { PendingExecutionTaskPayload } from '../pending-execution-worker'

export const pendingExecutionTask = task({
  id: 'pending-execution',
  maxDuration: timeout.None,
  retry: { maxAttempts: 10 },
  run: async (payload: PendingExecutionTaskPayload, { ctx, signal }) => {
    const { executePendingExecution } = await import('../pending-execution-worker')
    return executePendingExecution(
      payload,
      payload.executionType === 'workflow'
        ? { attempt: `${ctx.run.id}:${ctx.attempt.number}`, signal }
        : undefined
    )
  },
  onCancel: async ({ payload, ctx, runPromise }) => {
    if (payload.executionType !== 'workflow') return
    const result = await runPromise.catch(() => undefined)
    if (result?.skipped !== 'cancelled_before_dispatch') return
    const { requestCancelledWorkflowSettlement } = await import('@/lib/execution/pending-execution')
    await requestCancelledWorkflowSettlement(
      payload.pendingExecutionId,
      payload,
      Math.max(0, Date.now() - ctx.attempt.startedAt.getTime()),
      ctx.run.id,
      result.attempt
    )
  },
})
