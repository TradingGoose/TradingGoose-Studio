import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { applyWorkflowStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'

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

export async function applyWorkflowEntityName(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables: Record<string, any>,
  entityName: string
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowState(workflowId, workflowState, variables, entityName)

  const [updatedWorkflow] = await db
    .update(workflow)
    .set({ name: entityName, updatedAt: new Date() })
    .where(eq(workflow.id, workflowId))
    .returning()

  if (!updatedWorkflow) {
    throw new Error('Workflow not found')
  }

  return updatedWorkflow
}
