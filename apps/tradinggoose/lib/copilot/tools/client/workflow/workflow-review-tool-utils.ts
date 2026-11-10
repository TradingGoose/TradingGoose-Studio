'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { resolveOptionalCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import {
  readWorkflowContainerBoundaryEdgeViolation,
  readWorkflowEdgeScope,
} from '@/lib/workflows/studio-workflow-mermaid'
import {
  getVariablesSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { getRegisteredWorkflowSession } from '@/lib/yjs/workflow-session-registry'
import { acquireWritableWorkflowSessionLease } from '@/lib/yjs/workflow-shared-session'

type WorkflowTarget = {
  workflowId: string
  entityName?: string
  workspaceId?: string | null
}

export type WorkflowSummary = {
  blocks: Array<{
    blockId: string
    blockType: string
    blockName: string
    enabled?: boolean
    parentId?: string
    subBlockIds: string[]
    connections: {
      externalIn: number
      externalOut: number
      internalIn: number
      internalOut: number
    }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    scope: 'external' | 'internal'
  }>
  connectionIssues: Array<{
    edgeIndex: number
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    message: string
  }>
}

function normalizeWorkflowTargetValue(value?: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function buildWorkflowSummary(workflowState: WorkflowSnapshot): WorkflowSummary {
  const edges: WorkflowSummary['edges'] = (workflowState.edges ?? []).map((edge) => {
    return {
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === 'string' ? { targetHandle: edge.targetHandle } : {}),
      scope: readWorkflowEdgeScope(edge, workflowState.blocks ?? {}),
    }
  })
  const blockIds = Object.keys(workflowState.blocks ?? {}).sort()
  const connectionsByBlock = Object.fromEntries(
    blockIds.map((blockId) => [
      blockId,
      { externalIn: 0, externalOut: 0, internalIn: 0, internalOut: 0 },
    ])
  )

  edges.forEach((edge) => {
    const prefix = edge.scope === 'internal' ? 'internal' : 'external'
    if (connectionsByBlock[edge.source]) {
      connectionsByBlock[edge.source][`${prefix}Out`] += 1
    }
    if (connectionsByBlock[edge.target]) {
      connectionsByBlock[edge.target][`${prefix}In`] += 1
    }
  })

  return {
    blocks: blockIds.map((blockId) => {
      const block = workflowState.blocks[blockId]

      return {
        blockId,
        blockType: block.type,
        blockName:
          normalizeWorkflowTargetValue(typeof block.name === 'string' ? block.name : undefined) ??
          blockId,
        ...(typeof block.enabled === 'boolean' ? { enabled: block.enabled } : {}),
        ...(typeof block.data?.parentId === 'string' ? { parentId: block.data.parentId } : {}),
        subBlockIds: Object.keys(block.subBlocks ?? {}).sort(),
        connections: connectionsByBlock[blockId],
      }
    }),
    edges,
    connectionIssues: edges.flatMap((edge, edgeIndex) => {
      const message = readWorkflowContainerBoundaryEdgeViolation(edge, workflowState.blocks ?? {})
      const { scope: _scope, ...edgeWithoutScope } = edge
      return message ? [{ edgeIndex, ...edgeWithoutScope, message }] : []
    }),
  }
}

export async function resolveWorkflowTarget(
  executionContext: ClientToolExecutionContext,
  options: { entityId?: string } = {}
): Promise<WorkflowTarget> {
  const requestedWorkflowId = resolveOptionalCopilotEntityId(options)
  if (requestedWorkflowId) {
    return {
      workflowId: requestedWorkflowId,
      workspaceId: executionContext.workspaceId ?? null,
    }
  }

  throw new Error('Workflow target is required')
}

export async function getReadableWorkflowState(
  executionContext: ClientToolExecutionContext,
  entityId?: string
): Promise<{
  workflowId: string
  entityName?: string
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
