import { tasks } from '@trigger.dev/sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { createBackgroundExecutionTask } from '@/background/execution-job'
import type { copilotExecutionTask } from '@/background/tasks/copilot-execution'
import type { PendingExecutionPayload, PendingExecutionType } from './pending-execution'

export type BackgroundExecutionTaskPayload =
  | { pendingExecutionId: string; executionType: PendingExecutionType }
  | { id: string; executionType: 'copilot'; payload: PendingExecutionPayload }

type BackgroundTask = ReturnType<typeof createBackgroundExecutionTask> | typeof copilotExecutionTask
const logger = createLogger('BackgroundExecution')
const executionOptions = (executionType: string, id: string, maxDuration?: number) => ({
  idempotencyKey: `${executionType}-execution:${id}`,
  ...(maxDuration === undefined ? {} : { maxDuration }),
})

export function waitForBackgroundExecution(
  job: { id: string; executionType: PendingExecutionType },
  maxDuration?: number
) {
  return tasks.triggerAndWait<BackgroundTask>(
    `${job.executionType}-execution`,
    { pendingExecutionId: job.id, executionType: job.executionType },
    executionOptions(job.executionType, job.id, maxDuration)
  )
}

/** Admission is owned by the caller; this is the shared execution transport. */
export async function dispatchBackgroundExecution(
  payload: BackgroundExecutionTaskPayload,
  mode: 'trigger' | 'local'
): Promise<string | undefined> {
  const id = 'pendingExecutionId' in payload ? payload.pendingExecutionId : payload.id
  if (mode === 'trigger') {
    const handle = await tasks.trigger<BackgroundTask>(
      `${payload.executionType}-execution`,
      payload,
      executionOptions(payload.executionType, id)
    )
    return handle.id
  }
  const startedAt = Date.now()
  const execution =
    payload.executionType === 'copilot'
      ? import('@/lib/copilot/agent/worker').then(
          ({ executeCopilotJob, finalizeCopilotExecution }) => ({
            run: () => executeCopilotJob(payload.payload),
            fail: (error: unknown) =>
              finalizeCopilotExecution(
                payload.payload,
                error instanceof Error ? error.message : 'Copilot execution failed'
              ),
          })
        )
      : import('@/background/pending-execution-worker').then(
          ({ executePendingExecutionRun, finalizePendingExecutionRunFailure }) => ({
            run: () => executePendingExecutionRun(payload),
            fail: (error: unknown) => finalizePendingExecutionRunFailure(payload, error, startedAt),
          })
        )
  void execution
    .then(async ({ run, fail }) => {
      try {
        await run()
      } catch (error) {
        logger.error('Local execution failed', { id, error })
        await fail(error)
      }
    })
    .catch((error) => logger.error('Local execution cleanup failed', { id, error }))
}
