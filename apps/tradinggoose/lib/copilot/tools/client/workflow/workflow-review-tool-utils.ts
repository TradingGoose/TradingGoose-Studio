'use client'

import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import {
  createWorkflowSnapshot,
  getWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import {
  getVariablesForWorkflow,
  getRegisteredWorkflowSession,
} from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type WorkflowTarget = {
  workflowId: string
  workflowName?: string
  workspaceId?: string | null
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

async function workflowTargetFromApi(workflowId: string): Promise<WorkflowTarget | undefined> {
  const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: 'GET',
  })

  if (!response.ok) return undefined

  const payload = (await response.json().catch(() => null)) as {
    data?: {
      id?: string | null
      name?: string | null
      workspaceId?: string | null
    } | null
  } | null
  const resolvedWorkflowId = normalizeWorkflowTargetValue(payload?.data?.id)
  if (!resolvedWorkflowId) return undefined

  return {
    workflowId: resolvedWorkflowId,
    workflowName: payload?.data?.name || 'Untitled Workflow',
    workspaceId: payload?.data?.workspaceId ?? null,
  }
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
    throw new Error(payload?.error || bodyText || `Failed to fetch workflows: ${response.status}`)
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
  options: { workflowId?: string; workflow_name?: string } = {}
): Promise<WorkflowTarget> {
  const requestedWorkflowId = normalizeWorkflowTargetValue(options.workflowId)
  if (requestedWorkflowId) {
    const metadata = workflowTargetFromRegistry(requestedWorkflowId)
    return metadata ?? (await workflowTargetFromApi(requestedWorkflowId)) ?? {
      workflowId: requestedWorkflowId,
    }
  }

  const requestedWorkflowName = normalizeWorkflowTargetValue(options.workflow_name)
  if (requestedWorkflowName) {
    const matches = (await listWorkflowsForExecutionContext(executionContext)).filter(
      (workflow) =>
        workflow.workflowName?.trim().toLowerCase() === requestedWorkflowName.toLowerCase()
    )

    if (matches.length === 0) {
      throw new Error(`Workflow not found: ${requestedWorkflowName}`)
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple workflows named "${requestedWorkflowName}" found. Provide workflowId explicitly.`
      )
    }

    return matches[0]
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
      workflowState: getWorkflowSnapshot(liveSession.doc),
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
    throw new Error(
      bodyText || `Failed to fetch workflow ${resolvedWorkflowId}: ${response.status}`
    )
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: {
      workspaceId?: string | null
      state?: (Partial<WorkflowSnapshot> & { variables?: unknown }) | null
    } | null
  } | null
  const rawState = payload?.data?.state ?? {}
  const { variables, ...snapshotState } = rawState

  return {
    workflowId: resolvedWorkflowId,
    workflowState: createWorkflowSnapshot(snapshotState),
    workspaceId: payload?.data?.workspaceId ?? executionContext.workspaceId ?? null,
    variables: normalizeWorkflowVariables(variables),
    source: 'api',
  }
}
