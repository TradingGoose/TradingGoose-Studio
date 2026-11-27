import { task } from '@trigger.dev/sdk'
import type {
  BackgroundExecutionTaskPayload,
  backgroundTaskIds,
} from '@/lib/execution/background-execution'

export const copilotExecutionTask = task({
  id: 'copilot-execution' satisfies typeof backgroundTaskIds.copilot,
  retry: { maxAttempts: 1 },
  run: async (
    payload: Extract<BackgroundExecutionTaskPayload, { executionType: 'copilot' }>,
    { signal }
  ) => {
    if (payload.executionType !== 'copilot') throw new Error('Execution task type differs')
    const { executeCopilotJob } = await import('@/lib/copilot/agent/worker')
    await executeCopilotJob(payload.payload, signal)
  },
  onFailure: async ({ payload, error }) => {
    const { finalizeCopilotExecution } = await import('@/lib/copilot/agent/worker')
    await finalizeCopilotExecution(
      payload.payload,
      error instanceof Error ? error.message : 'Copilot execution failed'
    )
  },
  onCancel: async ({ payload, runPromise }) => {
    await runPromise.catch(() => undefined)
    const { finalizeCopilotExecution } = await import('@/lib/copilot/agent/worker')
    await finalizeCopilotExecution(payload.payload, 'Copilot execution was cancelled')
  },
})
