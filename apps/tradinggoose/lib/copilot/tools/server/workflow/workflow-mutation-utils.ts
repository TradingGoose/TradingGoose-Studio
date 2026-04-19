import { findIntroducedNonCanonicalSubBlocks } from '@/lib/workflows/block-config-canonicalization'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import {
  buildWorkflowDocumentPreviewDiff,
  serializeWorkflowToTgMermaid,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { normalizeWorkflowStateToMermaidDirection } from '@/lib/workflows/workflow-direction'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { WorkflowDirection } from '@/stores/workflows/workflow/types'

async function getCurrentWorkflowStateFromDb(workflowId: string): Promise<WorkflowSnapshot> {
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} not found in database`)
  }

  return createWorkflowSnapshot({
    blocks: normalized.blocks || {},
    edges: normalized.edges || [],
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  })
}

function parseCurrentWorkflowState(currentWorkflowState?: string): WorkflowSnapshot | undefined {
  if (!currentWorkflowState) {
    return undefined
  }

  try {
    return createWorkflowSnapshot(JSON.parse(currentWorkflowState))
  } catch {
    throw new Error('Invalid currentWorkflowState format')
  }
}

export async function loadBaseWorkflowState(
  workflowId: string,
  currentWorkflowState?: string
): Promise<WorkflowSnapshot> {
  return (
    parseCurrentWorkflowState(currentWorkflowState) ??
    (await getCurrentWorkflowStateFromDb(workflowId))
  )
}

export function buildWorkflowMutationResult(params: {
  workflowId: string
  baseWorkflowState: WorkflowSnapshot
  nextWorkflowState: WorkflowSnapshot
  requestedDirection?: WorkflowDirection
}) {
  const { workflowId, baseWorkflowState, nextWorkflowState, requestedDirection } = params
  const nonCanonicalSubBlockErrors = findIntroducedNonCanonicalSubBlocks(
    nextWorkflowState,
    baseWorkflowState
  )

  if (nonCanonicalSubBlockErrors.length > 0) {
    throw new Error(`Invalid edited workflow: ${nonCanonicalSubBlockErrors.join('; ')}`)
  }

  const validation = validateWorkflowState(nextWorkflowState, { sanitize: true })
  if (!validation.valid) {
    throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
  }

  let finalWorkflowState = createWorkflowSnapshot(
    (validation.sanitizedState as Partial<WorkflowSnapshot> | undefined) ?? nextWorkflowState
  )
  const direction =
    requestedDirection ?? finalWorkflowState.direction ?? baseWorkflowState.direction ?? 'TD'
  const orientationWarnings: string[] = []
  const normalizedWorkflow = normalizeWorkflowStateToMermaidDirection(finalWorkflowState, direction)

  if (normalizedWorkflow.didRelayout) {
    orientationWarnings.push(`Re-laid out workflow blocks to match Mermaid direction ${direction}.`)
  }

  finalWorkflowState = createWorkflowSnapshot(normalizedWorkflow.workflowState)
  const preview = buildWorkflowDocumentPreviewDiff(baseWorkflowState, finalWorkflowState)
  const warnings = Array.from(new Set([...orientationWarnings, ...preview.warnings, ...validation.warnings]))
  const workflowDocument = serializeWorkflowToTgMermaid(finalWorkflowState, { direction })

  return {
    success: true,
    entityKind: 'workflow' as const,
    entityId: workflowId,
    entityDocument: workflowDocument,
    workflowId,
    documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
    workflowDocument,
    workflowState: finalWorkflowState,
    preview: {
      ...preview,
      warnings,
    },
    data: {
      blocksCount: Object.keys(finalWorkflowState.blocks || {}).length,
      edgesCount: Array.isArray(finalWorkflowState.edges) ? finalWorkflowState.edges.length : 0,
    },
  }
}
