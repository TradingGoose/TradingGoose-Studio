import { task } from '@trigger.dev/sdk'
import {
  completeWorkflowExecutionOutbox,
  failWorkflowExecutionOutbox,
  type WorkflowExecutionOutboxClaim,
} from '@/lib/execution/workflow-execution-outbox'
import {
  projectChildWorkflowExecution,
  projectWorkflowExecutionTerminal,
  type WorkflowExecutionProjectionKind,
} from '@/lib/execution/workflow-execution-projections'
import type { ExecutionResult } from '@/executor/types'

export const workflowExecutionProject = task({
  id: 'workflow-execution-project',
  retry: { maxAttempts: 10 },
  run: async (claim: WorkflowExecutionOutboxClaim) => {
    const { rootExecutionId, kind, version } = claim
    const payload = claim.payload
    try {
      const projected =
        kind.startsWith('child_pending:') || kind.startsWith('child_terminal:')
          ? await projectChildWorkflowExecution({
              rootExecutionId,
              ...(payload as {
                pendingExecutionId: string
                attemptId: string
                result: ExecutionResult
              }),
            })
          : await projectWorkflowExecutionTerminal(
              rootExecutionId,
              version,
              kind as WorkflowExecutionProjectionKind
            )
      if (!projected) throw new Error('Workflow projection is not ready')
      await completeWorkflowExecutionOutbox(claim)
      return { projected: true }
    } catch (error) {
      await failWorkflowExecutionOutbox({
        ...claim,
        error: error instanceof Error ? error.message : 'Workflow projection failed',
      })
      throw error
    }
  },
})
