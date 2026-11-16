import { task, timeout } from '@trigger.dev/sdk'
import type { PendingExecutionTaskPayload } from '../pending-execution-worker'

export const pendingExecutionTask = task({
  id: 'pending-execution',
  maxDuration: timeout.None,
  retry: { maxAttempts: 10 },
  run: async (payload: PendingExecutionTaskPayload) => {
    const { executePendingExecution } = await import('../pending-execution-worker')
    return executePendingExecution(payload)
  },
})
