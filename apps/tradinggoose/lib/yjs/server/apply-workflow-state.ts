import * as Y from 'yjs'
import { setWorkflowState, setVariables, getMetadataMap } from '@/lib/yjs/workflow-session'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { getDocument, setPersistence } from '@/socket-server/yjs/upstream-utils'
import { getState, storeState } from '@/socket-server/yjs/persistence'
import { createLogger } from '@/lib/logs/console/logger'

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
  // Register persistence for this doc
  setPersistence(workflowId, { getState, storeState })

  // Get or create the doc
  const doc = getDocument(workflowId)

  // Apply the workflow state as a system replacement
  setWorkflowState(doc, workflowState, YJS_ORIGINS.SYSTEM)

  // Apply variables if provided
  if (variables) {
    setVariables(doc, variables, YJS_ORIGINS.SYSTEM)
  }

  // Clear reseeded flag since we just applied fresh state
  const metadata = getMetadataMap(doc)
  doc.transact(() => {
    metadata.delete('reseededFromCanonical')
  }, YJS_ORIGINS.SYSTEM)

  // Persist immediately
  const state = Y.encodeStateAsUpdate(doc)
  await storeState(workflowId, state)
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
