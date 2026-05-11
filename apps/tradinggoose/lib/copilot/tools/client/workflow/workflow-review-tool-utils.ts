'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import { readWorkflowContainerBoundaryEdgeViolation } from '@/lib/workflows/studio-workflow-mermaid'
import {
  createWorkflowSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import {
  getRegisteredWorkflowSession,
  getVariablesForWorkflow,
} from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type WorkflowTarget = {
  workflowId: string
  workflowName?: string
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
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
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

function workflowTargetFromRegistry(workflowId: string): WorkflowTarget | undefined {
  const workflow = useWorkflowRegistry.getState().workflows[workflowId]
  return workflow
    ? {
        workflowId: workflow.id,
        workflowName: workflow.name || 'Untitled Workflow',
        workspaceId: workflow.workspaceId ?? null,
      }
    : undefined
}

export function buildWorkflowDocumentToolResult(options: {
  workflowId: string
  workflowName?: string
  workspaceId?: string | null
  workflowDocument: string
}) {
  const workflowName = normalizeWorkflowTargetValue(options.workflowName)

  return {
    entityKind: 'workflow',
    entityId: options.workflowId,
    ...(workflowName ? { entityName: workflowName, workflowName } : {}),
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    entityDocument: options.workflowDocument,
    workflowId: options.workflowId,
    workflowDocument: options.workflowDocument,
    documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
  }
}

export function buildWorkflowSummary(workflowState: WorkflowSnapshot): WorkflowSummary {
  const edges = (workflowState.edges ?? []).map((edge) => ({
    source: edge.source,
    target: edge.target,
    ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
    ...(typeof edge.targetHandle === 'string' ? { targetHandle: edge.targetHandle } : {}),
  }))

  return {
    blocks: Object.entries(workflowState.blocks ?? {})
      .map(([blockId, block]) => ({
        blockId,
        blockType: block.type,
        blockName:
          normalizeWorkflowTargetValue(typeof block.name === 'string' ? block.name : undefined) ??
          blockId,
        ...(typeof block.enabled === 'boolean' ? { enabled: block.enabled } : {}),
        ...(typeof block.data?.parentId === 'string' ? { parentId: block.data.parentId } : {}),
        subBlockIds: Object.keys(block.subBlocks ?? {}).sort(),
      }))
      .sort((left, right) => left.blockId.localeCompare(right.blockId)),
    edges,
    connectionIssues: edges.flatMap((edge, edgeIndex) => {
      const message = readWorkflowContainerBoundaryEdgeViolation(edge, workflowState.blocks ?? {})
      return message ? [{ edgeIndex, ...edge, message }] : []
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
  const url = workspaceId
    ? `/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`
    : '/api/workflows'
  const response = await fetch(url, { method: 'GET' })
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
    return workflowId
      ? [
          {
            workflowId,
            workflowName: workflow.name || 'Untitled Workflow',
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
    return (
      workflowTargetFromRegistry(requestedWorkflowId) ?? {
        workflowId: requestedWorkflowId,
        workspaceId: executionContext.workspaceId ?? null,
      }
    )
  }

  throw new Error('Workflow target is required')
}

function normalizeWorkflowVariables(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, any>
}

export async function getReadableWorkflowState(
  executionContext: ClientToolExecutionContext,
  workflowId?: string
): Promise<{
  workflowId: string
  workflowName?: string
  workflowState: WorkflowSnapshot
  workspaceId: string | null
  variables: Record<string, any>
  source: 'live' | 'api'
}> {
  const resolvedWorkflowId = normalizeWorkflowTargetValue(workflowId)
  if (!resolvedWorkflowId) {
    throw new Error('Workflow target is required')
  }

  const liveSession = getRegisteredWorkflowSession(resolvedWorkflowId)
  const registryWorkflow = useWorkflowRegistry.getState().workflows[resolvedWorkflowId]

  if (liveSession) {
    return {
      workflowId: liveSession.workflowId,
      ...(registryWorkflow?.name ? { workflowName: registryWorkflow.name } : {}),
      workflowState: readWorkflowSnapshot(liveSession.doc),
      workspaceId: registryWorkflow?.workspaceId ?? executionContext.workspaceId ?? null,
      variables: getVariablesForWorkflow(liveSession.workflowId) ?? {},
      source: 'live',
    }
  }

  const response = await fetch(`/api/workflows/${encodeURIComponent(resolvedWorkflowId)}`, {
    method: 'GET',
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(bodyText || `Failed to read workflow ${resolvedWorkflowId}: ${response.status}`)
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: {
      name?: string | null
      workspaceId?: string | null
      state?: (Partial<WorkflowSnapshot> & { variables?: unknown }) | null
    } | null
  } | null
  const rawState = payload?.data?.state ?? {}
  const { variables, ...snapshotState } = rawState

  return {
    workflowId: resolvedWorkflowId,
    ...(payload?.data?.name ? { workflowName: payload.data.name } : {}),
    workflowState: createWorkflowSnapshot(snapshotState),
    workspaceId: payload?.data?.workspaceId ?? executionContext.workspaceId ?? null,
    variables: normalizeWorkflowVariables(variables),
    source: 'api',
  }
}
