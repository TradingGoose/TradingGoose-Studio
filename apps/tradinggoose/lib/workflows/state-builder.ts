import { getRegisteredWorkflowSession } from '@/lib/yjs/workflow-session-registry'
import { extractPersistedStateFromDoc, type PersistedDocState } from '@/lib/yjs/workflow-session'

/**
 * Build workflow state in the same format as the deployment process.
 * Includes variables so templates and exports preserve the full workflow.
 * Reads from the live Yjs session.
 */
export function buildWorkflowStateForTemplate(workflowId: string): PersistedDocState | null {
  const session = getRegisteredWorkflowSession(workflowId)
  if (!session?.doc) {
    return null
  }

  return extractPersistedStateFromDoc(session.doc)
}
