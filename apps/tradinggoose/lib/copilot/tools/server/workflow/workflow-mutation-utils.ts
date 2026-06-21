import * as Y from 'yjs'
import {
  type ServerToolExecutionContext,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import { findIntroducedNonCanonicalSubBlocks } from '@/lib/workflows/block-config-canonicalization'
import { WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import {
  buildWorkflowDocumentPreviewDiff,
  serializeWorkflowToGraphMermaid,
  serializeWorkflowToTgMermaid,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { normalizeWorkflowStateToMermaidDirection } from '@/lib/workflows/workflow-direction'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import {
  createWorkflowSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import type { WorkflowDirection } from '@/stores/workflows/workflow/types'

export async function loadBaseWorkflowState(
  workflowId: string,
  context?: ServerToolExecutionContext
): Promise<WorkflowSnapshot> {
  const userId = context?.userId?.trim()
  if (!userId) {
    throw new Error('Authenticated user is required to edit workflow state')
  }

  const { verifyWorkflowAccess } = await import('@/lib/copilot/review-sessions/permissions')
  const access = await verifyWorkflowAccess(userId, workflowId, 'write')
  if (!access.hasAccess) {
    throw new Error('Access denied: You do not have permission to edit this workflow')
  }

  const snapshot = await readBootstrappedReviewTargetSnapshot({
    workspaceId: access.workspaceId ?? context?.workspaceId ?? null,
    entityKind: 'workflow',
    entityId: workflowId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: workflowId,
  })

  if (!snapshot.snapshotBase64) {
    throw new Error(`Current Yjs workflow state is required for ${workflowId}`)
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return createWorkflowSnapshot(readWorkflowSnapshot(doc))
  } finally {
    doc.destroy()
  }
}

export function buildWorkflowMutationResult(params: {
  workflowId: string
  baseWorkflowState: WorkflowSnapshot
  nextWorkflowState: WorkflowSnapshot
  requestedDirection?: WorkflowDirection
  entityDocument?: string
  documentFormat?: string
}) {
  const { workflowId, baseWorkflowState, nextWorkflowState, requestedDirection } = params
  const documentFormat = params.documentFormat ?? TG_MERMAID_DOCUMENT_FORMAT
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
  const warnings = Array.from(
    new Set([...orientationWarnings, ...preview.warnings, ...validation.warnings])
  )
  const entityDocument =
    params.entityDocument ??
    (documentFormat === WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT
      ? serializeWorkflowToGraphMermaid(finalWorkflowState, { direction })
      : serializeWorkflowToTgMermaid(finalWorkflowState, { direction }))

  return {
    requiresReview: true,
    success: true,
    entityKind: 'workflow' as const,
    entityId: workflowId,
    entityDocument,
    documentFormat,
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

export async function resolveWorkflowMutationResultForExecution(
  result: ReturnType<typeof buildWorkflowMutationResult>,
  context?: ServerToolExecutionContext
) {
  if (shouldStageServerToolMutationForReview(context)) {
    return result
  }

  await applyWorkflowState(
    result.entityId,
    createWorkflowSnapshot(result.workflowState as Partial<WorkflowSnapshot>)
  )

  const { requiresReview: _requiresReview, preview: _preview, ...appliedResult } = result
  return appliedResult
}
