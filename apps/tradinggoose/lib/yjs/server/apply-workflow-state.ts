import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { applyWorkflowStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

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
  variables?: Record<string, any>,
  entityName?: string
): Promise<void> {
  await applyWorkflowStateInSocketServer(workflowId, workflowState, variables, entityName)
}
