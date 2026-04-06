'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import {
  createWorkflowSnapshot,
  getWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
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

/**
 * Read-only workflow tools should prefer the live Yjs document when it exists,
 * but they can safely fall back to the persisted workflow API when no client
 * session is mounted yet. Mutating tools must continue using the live-session
 * helpers above so they never write against stale state.
 */
export async function getReadableWorkflowSnapshot(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): Promise<{ workflowId: string; workflowState: WorkflowSnapshot; source: 'live' | 'db' }> {
  const resolvedWorkflowId = resolveWorkflowIdFromExecutionContext(executionContext, workflowId)
  const liveSession = getRegisteredWorkflowSession(resolvedWorkflowId)

  if (liveSession) {
    return {
      workflowId: liveSession.workflowId,
      workflowState: getWorkflowSnapshot(liveSession.doc),
      source: 'live',
    }
  }

  const response = await fetch(`/api/workflows/${encodeURIComponent(resolvedWorkflowId)}`, {
    method: 'GET',
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      bodyText || `Failed to fetch workflow ${resolvedWorkflowId}: ${response.status}`
    )
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: {
      state?: Partial<WorkflowSnapshot> | null
    } | null
  } | null

  return {
    workflowId: resolvedWorkflowId,
    workflowState: createWorkflowSnapshot(payload?.data?.state ?? {}),
    source: 'db',
  }
}

export async function serializeReadableWorkflowSnapshot(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): Promise<{
  workflowId: string
  currentUserWorkflow: string
  workflowState: WorkflowSnapshot
  source: 'live' | 'db'
}> {
  const { workflowId: resolvedWorkflowId, workflowState, source } = await getReadableWorkflowSnapshot(
    executionContext,
    workflowId
  )

  return {
    workflowId: resolvedWorkflowId,
    currentUserWorkflow: JSON.stringify(workflowState),
    workflowState,
    source,
  }
}
