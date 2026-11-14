'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { resolveOptionalCopilotEntityId } from '@/lib/copilot/tools/entity-target'
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

function normalizeWorkflowTargetValue(value?: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
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

export async function getReadableWorkflowState(
  executionContext: ClientToolExecutionContext,
  entityId?: string
): Promise<{
  workflowId: string
  workflowState: WorkflowSnapshot
  workspaceId: string | null
  variables: Record<string, any>
}> {
  const resolvedWorkflowId = normalizeWorkflowTargetValue(entityId)
  if (!resolvedWorkflowId) {
    throw new Error('Workflow target is required')
  }

  const liveSession = getRegisteredWorkflowSession(resolvedWorkflowId)

  if (liveSession) {
    return {
      workflowId: liveSession.workflowId,
      workflowState: readWorkflowSnapshot(liveSession.doc),
      workspaceId: liveSession.workspaceId ?? null,
      variables: getVariablesSnapshot(liveSession.doc),
    }
  }

  const lease = await acquireWritableWorkflowSessionLease({
    workflowId: resolvedWorkflowId,
    workspaceId: executionContext.workspaceId ?? null,
  })
  try {
    return {
      workflowId: lease.session.workflowId,
      workflowState: readWorkflowSnapshot(lease.session.doc),
      workspaceId: lease.session.workspaceId ?? null,
      variables: getVariablesSnapshot(lease.session.doc),
    }
  } finally {
    lease.release()
  }
}
