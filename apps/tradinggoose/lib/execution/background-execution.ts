import { tasks } from '@trigger.dev/sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { BackgroundExecutionJob } from '@/background/execution-job'
import type { backgroundExecutionTask } from '@/background/pending-execution-worker'

export const BACKGROUND_EXECUTION_TASK_ID = 'background-execution'
export type BackgroundExecutionTaskPayload =
  | { pendingExecutionId: string }
  | (BackgroundExecutionJob & { executionType: 'copilot' })

const logger = createLogger('BackgroundExecution')
const executionOptions = (id: string, maxDuration?: number) => ({
  idempotencyKey: `${BACKGROUND_EXECUTION_TASK_ID}:${id}`,
  ...(maxDuration === undefined ? {} : { maxDuration }),
})

export function waitForBackgroundExecution(pendingExecutionId: string, maxDuration?: number) {
  return tasks.triggerAndWait<typeof backgroundExecutionTask>(
    BACKGROUND_EXECUTION_TASK_ID,
    { pendingExecutionId },
    executionOptions(pendingExecutionId, maxDuration)
  )
}

/** Admission is owned by the caller; this is the shared execution transport. */
export async function dispatchBackgroundExecution(
  payload: BackgroundExecutionTaskPayload,
  mode: 'trigger' | 'local'
): Promise<string | undefined> {
  const id = 'pendingExecutionId' in payload ? payload.pendingExecutionId : payload.id
  if (mode === 'trigger') {
    const handle = await tasks.trigger<typeof backgroundExecutionTask>(
      BACKGROUND_EXECUTION_TASK_ID,
      payload,
      executionOptions(id)
    )
    return handle.id
  }
  const startedAt = Date.now()
  void import('@/background/pending-execution-worker')
    .then(async ({ executeBackgroundExecutionRun, finalizeBackgroundExecutionFailure }) => {
      try {
        await executeBackgroundExecutionRun(payload, { triggerRuntime: false })
      } catch (error) {
        logger.error('Local execution failed', { id, error })
        await finalizeBackgroundExecutionFailure(payload, error, startedAt)
      }
    })
    .catch((error) => logger.error('Local execution cleanup failed', { id, error }))
}
