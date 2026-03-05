import type { Edge } from 'reactflow'

const VALID_HANDLES = new Set(['source', 'target', 'success', 'error', 'default', 'condition'])

interface EdgeDiffAnalysis {
  edge_diff?: {
    deleted_edges?: string[]
  }
}

interface DeriveCanvasEdgesParams {
  edges: Edge[]
  isShowingDiff: boolean
  isDiffReady: boolean
  diffAnalysis?: EdgeDiffAnalysis | null
  blocks: Record<string, unknown>
}

type DeletedEdgeParts = {
  sourceId: string
  sourceHandle: string
  targetId: string
  targetHandle: string
}

function parseDeletedEdgeIdentifier(identifier: string): DeletedEdgeParts | null {
  const parts = identifier.split('-')
  if (parts.length < 4) {
    return null
  }

  let sourceHandleIndex = -1
  let targetStartIndex = -1

  for (let i = 1; i < parts.length - 1; i += 1) {
    if (!VALID_HANDLES.has(parts[i])) {
      continue
    }

    sourceHandleIndex = i

    for (let j = i + 1; j < parts.length - 1; j += 1) {
      if (parts[j].length > 0) {
        targetStartIndex = j
        break
      }
    }

    break
  }

  if (sourceHandleIndex <= 0 || targetStartIndex <= 0) {
    return null
  }

  const sourceId = parts.slice(0, sourceHandleIndex).join('-')
  const sourceHandle = parts[sourceHandleIndex]
  const targetHandle = parts[parts.length - 1]
  const targetId = parts.slice(targetStartIndex, parts.length - 1).join('-')

  if (!sourceId || !targetId || !sourceHandle || !targetHandle) {
    return null
  }

  return {
    sourceId,
    sourceHandle,
    targetId,
    targetHandle,
  }
}

export function deriveCanvasEdges({
  edges,
  isShowingDiff,
  isDiffReady,
  diffAnalysis,
  blocks,
}: DeriveCanvasEdgesParams): Edge[] {
  if (isShowingDiff || !isDiffReady || !diffAnalysis?.edge_diff?.deleted_edges?.length) {
    return edges
  }

  const reconstructed: Edge[] = []

  for (const identifier of diffAnalysis.edge_diff.deleted_edges) {
    const parsed = parseDeletedEdgeIdentifier(identifier)
    if (!parsed) {
      continue
    }

    if (!blocks[parsed.sourceId] || !blocks[parsed.targetId]) {
      continue
    }

    reconstructed.push({
      id: `deleted-${parsed.sourceId}-${parsed.sourceHandle}-${parsed.targetId}-${parsed.targetHandle}`,
      source: parsed.sourceId,
      target: parsed.targetId,
      sourceHandle: parsed.sourceHandle,
      targetHandle: parsed.targetHandle,
      type: 'workflowEdge',
      data: {
        isDeleted: true,
      },
    })
  }

  if (reconstructed.length === 0) {
    return edges
  }

  return [...edges, ...reconstructed]
}
