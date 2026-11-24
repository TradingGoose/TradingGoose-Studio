import { tasks } from '@trigger.dev/sdk'
import type { createBackgroundExecutionTask } from '@/background/execution-job'
import type { copilotExecutionTask } from '@/background/tasks/copilot-execution'
import type { PendingExecutionPayload, PendingExecutionType } from './pending-execution'

export const backgroundTaskIds = {
  workflow: 'workflow-execution',
  webhook: 'webhook-execution',
  schedule: 'schedule-execution',
  monitor: 'monitor-execution',
  document: 'knowledge-process-document',
  copilot: 'copilot-execution',
} as const satisfies Record<PendingExecutionType | 'copilot', string>

export type BackgroundExecutionTaskPayload =
  | { pendingExecutionId: string; executionType: PendingExecutionType }
  | { id: string; executionType: 'copilot'; payload: PendingExecutionPayload }

type PendingTask = ReturnType<typeof createBackgroundExecutionTask>

export function waitForBackgroundExecution(
  job: { id: string; executionType: PendingExecutionType },
  maxDuration?: number
) {
  const taskId = backgroundTaskIds[job.executionType]
  return tasks.triggerAndWait<PendingTask>(
    taskId,
    { pendingExecutionId: job.id },
    { idempotencyKey: `${taskId}:${job.id}`, maxDuration }
  )
}

/** Admission is owned by the caller; this is the shared execution transport. */
export async function dispatchBackgroundExecution(
  payload: BackgroundExecutionTaskPayload,
  mode: 'trigger' | 'local',
  localDocumentNonce?: string
): Promise<string | undefined> {
  const id = 'pendingExecutionId' in payload ? payload.pendingExecutionId : payload.id
  if (mode === 'trigger') {
    if (payload.executionType !== 'copilot') throw new Error('Queued jobs require the supervisor')
    const taskId = backgroundTaskIds.copilot
    const handle = await tasks.trigger<typeof copilotExecutionTask>(taskId, payload, {
      idempotencyKey: `${taskId}:${id}`,
    })
    return handle.id
  }
  const startedAt = Date.now()
  async function runLocal() {
    try {
      if (payload.executionType === 'copilot') {
        const { executeCopilotJob } = await import('@/lib/copilot/agent/worker')
        await executeCopilotJob(payload.payload, undefined, 'local')
      } else {
        const { executePendingExecutionRun } = await import('@/background/pending-execution-worker')
        await executePendingExecutionRun(payload, undefined, localDocumentNonce)
      }
    } catch (error) {
      const { createLogger } = await import('@/lib/logs/console/logger')
      createLogger('BackgroundExecution').error('Local execution failed', { id, error })
      const message = error instanceof Error ? error.message : 'Local execution failed'
      if (payload.executionType === 'copilot') {
        const { finalizeCopilotExecution } = await import('@/lib/copilot/agent/worker')
        await finalizeCopilotExecution(payload.payload, message, 'local')
      } else if (payload.executionType === 'document') {
        if (!localDocumentNonce) throw new Error('Missing local document claim')
        const { failDocumentAttempt } = await import('@/lib/knowledge/documents/claim')
        await failDocumentAttempt({ id, localDocumentNonce }, message)
      } else {
        const { finalizePendingExecutionRunFailure } = await import(
          '@/background/pending-execution-worker'
        )
        await finalizePendingExecutionRunFailure(payload, error, startedAt)
      }
    } finally {
      if (localDocumentNonce) {
        const { disarmLocalDocument } = await import('@/lib/knowledge/documents/local-heartbeat')
        disarmLocalDocument(id, localDocumentNonce)
      }
    }
  }
  void runLocal().catch(async (error) => {
    const { createLogger } = await import('@/lib/logs/console/logger')
    createLogger('BackgroundExecution').error('Local execution cleanup failed', { id, error })
  })
}
