'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
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

export function buildWorkflowDocumentToolResult(options: {
  workflowId: string
  entityName?: string
  workspaceId?: string | null
  entityDocument: string
}) {
  const entityName = normalizeWorkflowTargetValue(options.entityName)

  return {
    entityKind: 'workflow',
    entityId: options.workflowId,
    ...(entityName ? { entityName } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    entityDocument: options.entityDocument,
    documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
  }
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

export function resolveWorkflowWorkspaceId(
  executionContext: ClientToolExecutionContext
): string | undefined {
  return executionContext.workspaceId ?? undefined
}

export async function listWorkflowsForExecutionContext(
  executionContext: ClientToolExecutionContext
): Promise<WorkflowTarget[]> {
  const workspaceId = resolveWorkflowWorkspaceId(executionContext)
  if (!workspaceId) {
    throw new Error('Workspace ID is required to list workflows')
  }

  const response = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`, {
    method: 'GET',
  })
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: string | null
      name?: string | null
      workspaceId?: string | null
    }>
    error?: string
  } | null

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(payload?.error || bodyText || `Failed to list workflows: ${response.status}`)
  }

  return (payload?.data ?? []).flatMap((workflow) => {
    const workflowId = normalizeWorkflowTargetValue(workflow.id)
    const entityName = normalizeWorkflowTargetValue(workflow.name)
    return workflowId
      ? [
          {
            workflowId,
            ...(entityName ? { entityName } : {}),
            workspaceId: workflow.workspaceId ?? null,
          },
        ]
      : []
  })
}

export async function resolveWorkflowTarget(
  executionContext: ClientToolExecutionContext,
  options: { workflowId?: string } = {}
): Promise<WorkflowTarget> {
  const requestedWorkflowId = normalizeWorkflowTargetValue(options.workflowId)
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
  workflowId?: string
): Promise<{
  workflowId: string
  entityName?: string
  workflowState: WorkflowSnapshot
  workspaceId: string | null
  variables: Record<string, any>
  source: 'live' | 'yjs'
}> {
  const resolvedWorkflowId = normalizeWorkflowTargetValue(workflowId)
  if (!resolvedWorkflowId) {
    throw new Error('Workflow target is required')
  }

  const liveSession = getRegisteredWorkflowSession(resolvedWorkflowId)

  if (liveSession) {
    const entityName = normalizeWorkflowTargetValue(liveSession.entityName)
    return {
      workflowId: liveSession.workflowId,
      ...(entityName ? { entityName } : {}),
      workflowState: readWorkflowSnapshot(liveSession.doc),
      workspaceId: liveSession.workspaceId ?? null,
      variables: getVariablesSnapshot(liveSession.doc),
      source: 'live',
    }
  }

  const lease = await acquireWritableWorkflowSessionLease({
    workflowId: resolvedWorkflowId,
    workspaceId: executionContext.workspaceId ?? null,
  })
  try {
    const entityName = normalizeWorkflowTargetValue(lease.session.entityName)
    return {
      workflowId: lease.session.workflowId,
      ...(entityName ? { entityName } : {}),
      workflowState: readWorkflowSnapshot(lease.session.doc),
      workspaceId: lease.session.workspaceId ?? null,
      variables: getVariablesSnapshot(lease.session.doc),
      source: 'yjs',
    }
  } finally {
    lease.release()
  }
}
