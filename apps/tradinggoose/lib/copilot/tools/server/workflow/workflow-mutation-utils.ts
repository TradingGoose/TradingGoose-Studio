import * as Y from 'yjs'
import {
  type ServerToolExecutionContext,
  shouldStageServerToolMutationForReview,
} from '@/lib/copilot/tools/server/base-tool'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { findIntroducedNonCanonicalSubBlocks } from '@/lib/workflows/block-config-canonicalization'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import {
  createWorkflowSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'

function buildWorkflowDocumentPreviewDiff(
  currentWorkflowState: WorkflowSnapshot | undefined,
  nextWorkflowState: WorkflowSnapshot
): {
  blockDiff: { added: string[]; removed: string[]; updated: string[] }
  edgeDiff: {
    added: Array<
      Pick<WorkflowSnapshot['edges'][number], 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
    >
    removed: Array<
      Pick<WorkflowSnapshot['edges'][number], 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
    >
  }
  warnings: string[]
} {
  const currentBlocks = currentWorkflowState?.blocks ?? {}
  const nextBlocks = nextWorkflowState.blocks ?? {}

  const currentBlockIds = new Set(Object.keys(currentBlocks))
  const nextBlockIds = new Set(Object.keys(nextBlocks))

  const added = [...nextBlockIds].filter((blockId) => !currentBlockIds.has(blockId)).sort()
  const removed = [...currentBlockIds].filter((blockId) => !nextBlockIds.has(blockId)).sort()
  const updated = [...nextBlockIds]
    .filter((blockId) => currentBlockIds.has(blockId))
    .filter(
      (blockId) =>
        stableStringifyJsonValue(currentBlocks[blockId]) !==
        stableStringifyJsonValue(nextBlocks[blockId])
    )
    .sort()

  const toComparableEdge = (edge: WorkflowSnapshot['edges'][number]) => ({
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || 'source',
    targetHandle: edge.targetHandle || 'target',
  })

  const currentEdges = (currentWorkflowState?.edges ?? []).map(toComparableEdge)
  const nextEdges = (nextWorkflowState.edges ?? []).map(toComparableEdge)
  const currentEdgeKeys = new Set(
    currentEdges.map(
      (edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
    )
  )
  const nextEdgeKeys = new Set(
    nextEdges.map(
      (edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
    )
  )

  const edgeDiff = {
    added: nextEdges.filter(
      (edge) =>
        !currentEdgeKeys.has(
          `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
        )
    ),
    removed: currentEdges.filter(
      (edge) =>
        !nextEdgeKeys.has(
          `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
        )
    ),
  }

  const warnings: string[] = []
  if (added.length === 0 && removed.length === 0 && updated.length === 0) {
    warnings.push('No block changes detected.')
  }
  if (edgeDiff.added.length === 0 && edgeDiff.removed.length === 0) {
    warnings.push('No edge changes detected.')
  }

  return {
    blockDiff: { added, removed, updated },
    edgeDiff,
    warnings,
  }
}

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
  renderEntityDocument: (workflowState: WorkflowSnapshot) => string
  documentFormat: string
}) {
  const { workflowId, baseWorkflowState, nextWorkflowState } = params
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

  const finalWorkflowState = createWorkflowSnapshot(
    (validation.sanitizedState as Partial<WorkflowSnapshot> | undefined) ?? nextWorkflowState
  )

  const preview = buildWorkflowDocumentPreviewDiff(baseWorkflowState, finalWorkflowState)
  const warnings = Array.from(new Set([...preview.warnings, ...validation.warnings]))
  const entityDocument = params.renderEntityDocument(finalWorkflowState)

  return {
    requiresReview: true,
    success: true,
    entityKind: 'workflow' as const,
    entityId: workflowId,
    entityDocument,
    documentFormat: params.documentFormat,
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
