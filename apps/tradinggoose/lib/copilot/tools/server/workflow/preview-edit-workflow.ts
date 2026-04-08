import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'

interface PreviewEditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: Record<string, any>
}

interface PreviewEditWorkflowParams {
  operations: PreviewEditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

type EdgeInfo = {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

function edgeKey(edge: EdgeInfo): string {
  const sourceHandle = edge.sourceHandle || 'source'
  const targetHandle = edge.targetHandle || 'target'
  return `${edge.source}:${sourceHandle}->${edge.target}:${targetHandle}`
}

function normalizeEdges(state: any): EdgeInfo[] {
  const edges = Array.isArray(state?.edges) ? state.edges : []
  return edges
    .filter((edge: any) => edge && typeof edge.source === 'string' && typeof edge.target === 'string')
    .map((edge: any) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'source',
      targetHandle: edge.targetHandle || 'target',
    }))
}

function summarizeConnections(
  baseState: any | undefined,
  modifiedState: any,
  operations: PreviewEditWorkflowOperation[]
) {
  const baseEdges = normalizeEdges(baseState)
  const modifiedEdges = normalizeEdges(modifiedState)
  const baseKeys = new Set(baseEdges.map(edgeKey))
  const modifiedKeys = new Set(modifiedEdges.map(edgeKey))

  const affectedBlocks = Array.from(
    new Set((operations || []).map((op) => op.block_id).filter(Boolean))
  )
  const affectedSet = new Set(affectedBlocks)

  const addedEdges = modifiedEdges.filter(
    (edge) =>
      !baseKeys.has(edgeKey(edge)) &&
      (affectedSet.has(edge.source) || affectedSet.has(edge.target))
  )
  const removedEdges = baseEdges.filter(
    (edge) =>
      !modifiedKeys.has(edgeKey(edge)) &&
      (affectedSet.has(edge.source) || affectedSet.has(edge.target))
  )

  const byBlock = affectedBlocks.map((blockId) => {
    const incoming = modifiedEdges.filter((edge) => edge.target === blockId)
    const outgoing = modifiedEdges.filter((edge) => edge.source === blockId)
    return { blockId, incoming, outgoing }
  })

  const warnings: string[] = []
  if (addedEdges.length === 0 && removedEdges.length === 0) {
    warnings.push('No edge changes detected. If this edit should rewire blocks, check connections.')
  }

  for (const op of operations || []) {
    if (op.operation_type === 'add') {
      const summary = byBlock.find((entry) => entry.blockId === op.block_id)
      if (summary) {
        if (summary.incoming.length === 0) {
          warnings.push(`Added block ${op.block_id} has no incoming edges.`)
        }
        if (summary.outgoing.length === 0) {
          warnings.push(`Added block ${op.block_id} has no outgoing edges.`)
        }
      }
      if (!op.params || !('connections' in op.params)) {
        warnings.push(
          `Add operation for ${op.block_id} did not include connections; ensure wiring matches intent.`
        )
      }
    }
  }

  return {
    affectedBlocks: byBlock,
    edgeDiff: { added: addedEdges, removed: removedEdges },
    warnings,
  }
}

export const previewEditWorkflowServerTool: BaseServerTool<PreviewEditWorkflowParams, any> = {
  name: 'preview_edit_workflow',
  async execute(params: PreviewEditWorkflowParams): Promise<any> {
    // Reuse edit_workflow logic without introducing approval-time side effects.
    const result = await editWorkflowServerTool.execute(params as any, undefined)

    let baseState: any | undefined
    if (params.currentUserWorkflow) {
      try {
        baseState = JSON.parse(params.currentUserWorkflow)
      } catch {
        baseState = undefined
      }
    }

    const preview = summarizeConnections(baseState, result?.workflowState, params.operations)

    let userWorkflow: string | undefined
    if (result?.workflowState) {
      try {
        userWorkflow = JSON.stringify(sanitizeForCopilot(result.workflowState), null, 2)
      } catch {
        userWorkflow = undefined
      }
    }

    return {
      ...result,
      preview,
      ...(userWorkflow ? { userWorkflow, yamlContent: userWorkflow } : {}),
    }
  },
}
