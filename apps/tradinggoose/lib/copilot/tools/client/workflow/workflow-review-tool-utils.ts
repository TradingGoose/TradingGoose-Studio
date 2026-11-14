'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import {
  requireCopilotEntityId,
  resolveOptionalCopilotEntityId,
} from '@/lib/copilot/tools/entity-target'
import {
  getVariablesSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { getRegisteredWorkflowSession } from '@/lib/yjs/workflow-session-registry'
import { acquireWritableWorkflowSessionLease } from '@/lib/yjs/workflow-shared-session'

type WorkflowTarget = {
  workflowId: string
  workspaceId?: string | null
}

export async function resolveWorkflowTarget(
  executionContext: ClientToolExecutionContext,
  options: { entityId?: string; signal?: AbortSignal } = {}
): Promise<WorkflowTarget> {
  const requestedWorkflowId = resolveOptionalCopilotEntityId(options)
  if (requestedWorkflowId) {
    if (executionContext.workspaceId)
      return { workflowId: requestedWorkflowId, workspaceId: executionContext.workspaceId }
    options.signal?.throwIfAborted()
    const response = await fetch(`/api/workflows/${encodeURIComponent(requestedWorkflowId)}`, {
      signal: options.signal,
    })
    if (!response.ok) throw new Error('Workflow target is unavailable')
    const { data } = await response.json()
    options.signal?.throwIfAborted()
    if (
      data?.id !== requestedWorkflowId ||
      typeof data.workspaceId !== 'string' ||
      !data.workspaceId.trim()
    )
      throw new Error('Workflow workspace is unavailable')
    return { workflowId: requestedWorkflowId, workspaceId: data.workspaceId }
  }

  throw new Error('Workflow target is required')
}

export async function getReadableWorkflowState(entityId?: string): Promise<{
  workflowState: WorkflowSnapshot
  workspaceId: string | null
  variables: Record<string, any>
}> {
  const resolvedWorkflowId = requireCopilotEntityId({ entityId })

  const liveSession = getRegisteredWorkflowSession(resolvedWorkflowId)

  if (liveSession) {
    return {
      workflowState: readWorkflowSnapshot(liveSession.doc),
      workspaceId: liveSession.workspaceId ?? null,
      variables: getVariablesSnapshot(liveSession.doc),
    }
  }

  const lease = await acquireWritableWorkflowSessionLease({
    workflowId: resolvedWorkflowId,
    workspaceId: null,
  })
  try {
    return {
      workflowState: readWorkflowSnapshot(lease.session.doc),
      workspaceId: lease.session.workspaceId ?? null,
      variables: getVariablesSnapshot(lease.session.doc),
    }
  } finally {
    lease.release()
  }
}
