import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { createLogger } from '@/lib/logs/console/logger'
import { applyWorkflowStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('ApplyWorkflowState')

/**
 * Applies a complete workflow state replacement to the Yjs doc for a workflow.
 * This is the server-only bridge used by POST /api/workflows, duplicate, template-use,
 * checkpoint-revert, deployment-revert, and workspace bootstrap.
 *
 * Server routes must not bypass this helper by posting raw body state directly
 * to a save route that now reads from Yjs.
 */
export async function applyWorkflowState(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): Promise<void> {
  await applyWorkflowStateInSocketServer(workflowId, workflowState, variables)
}

/**
 * Non-fatal wrapper around `applyWorkflowState`.  Catches any error, logs a
 * warning, and returns a result object so callers don't need their own
 * try/catch for what is typically a "best-effort" Yjs sync.
 */
export async function tryApplyWorkflowState(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): Promise<{ success: boolean; error?: unknown }> {
  try {
    await applyWorkflowState(workflowId, workflowState, variables)
    return { success: true }
  } catch (error) {
    logger.warn('Failed to apply workflow state to Yjs doc (non-fatal)', {
      workflowId,
      error,
    })
    return { success: false, error }
  }
}
