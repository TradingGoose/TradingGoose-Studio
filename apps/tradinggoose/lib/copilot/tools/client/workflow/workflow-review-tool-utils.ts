'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { getWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  getRegisteredWorkflowSession,
  type RegisteredWorkflowSession,
} from '@/lib/yjs/workflow-session-registry'

export function resolveWorkflowIdFromExecutionContext(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): string {
  const resolvedWorkflowId = workflowId ?? executionContext.workflowId
  if (!resolvedWorkflowId) {
    throw new Error('No active workflow found')
  }

  return resolvedWorkflowId
}

export function requireActiveWorkflowSession(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): RegisteredWorkflowSession {
  const resolvedWorkflowId = resolveWorkflowIdFromExecutionContext(executionContext, workflowId)
  const session = getRegisteredWorkflowSession(resolvedWorkflowId)
  if (!session) {
    throw new Error(`No active workflow session found for workflow ${resolvedWorkflowId}`)
  }

  return session
}

export function getLiveWorkflowSnapshot(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): { workflowId: string; workflowState: WorkflowSnapshot } {
  const session = requireActiveWorkflowSession(executionContext, workflowId)
  return {
    workflowId: session.workflowId,
    workflowState: getWorkflowSnapshot(session.doc),
  }
}

export function serializeLiveWorkflowSnapshot(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): { workflowId: string; currentUserWorkflow: string; workflowState: WorkflowSnapshot } {
  const { workflowId: resolvedWorkflowId, workflowState } = getLiveWorkflowSnapshot(
    executionContext,
    workflowId
  )

  return {
    workflowId: resolvedWorkflowId,
    currentUserWorkflow: JSON.stringify(workflowState),
    workflowState,
  }
}
