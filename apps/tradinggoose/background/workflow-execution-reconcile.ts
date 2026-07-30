import { task } from '@trigger.dev/sdk'
import { reconcileWorkflowExecutionDeadline } from '@/lib/execution/workflow-execution-deadline-repository'
import {
  completeWorkflowExecutionOutbox,
  failWorkflowExecutionOutbox,
  type WorkflowExecutionOutboxClaim,
} from '@/lib/execution/workflow-execution-outbox'

export const workflowExecutionReconcile = task({
  id: 'workflow-execution-reconcile',
  retry: { maxAttempts: 10 },
  run: async (claim: WorkflowExecutionOutboxClaim) => {
    const { rootExecutionId } = claim
    try {
      const result = await reconcileWorkflowExecutionDeadline(rootExecutionId)
      await completeWorkflowExecutionOutbox(claim)
      return result
    } catch (error) {
      await failWorkflowExecutionOutbox({
        ...claim,
        error: error instanceof Error ? error.message : 'Deadline reconciliation failed',
      })
      throw error
    }
  },
})
