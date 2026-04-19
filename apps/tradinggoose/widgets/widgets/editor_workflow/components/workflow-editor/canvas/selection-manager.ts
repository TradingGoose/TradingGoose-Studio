import type { Edge, Node } from '@xyflow/react'

export interface SelectedEdgeInfo {
  id: string
  parentLoopId?: string
  contextId: string
}

export function createNodeIndex(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((node) => [node.id, node]))
}

export function getSingleSelectedNodeId(nodes: Node[]): string | null {
  const selectedNode = nodes.find((node) => node.selected)
  return selectedNode?.id ?? null
}

function getParentLoopIdForEdge(edge: Edge, nodeIndex: Map<string, Node>): string | undefined {
  const sourceNode = nodeIndex.get(edge.source)
  const targetNode = nodeIndex.get(edge.target)
  return sourceNode?.parentId || targetNode?.parentId
}

function buildEdgeContextId(edgeId: string, parentLoopId?: string): string {
  return `${edgeId}${parentLoopId ? `-${parentLoopId}` : ''}`
}

export function getSelectedEdgeInfo(edge: Edge, nodeIndex: Map<string, Node>): SelectedEdgeInfo {
  const parentLoopId = getParentLoopIdForEdge(edge, nodeIndex)
  return {
    id: edge.id,
    parentLoopId,
    contextId: buildEdgeContextId(edge.id, parentLoopId),
  }
}

interface DeriveEdgesWithSelectionParams {
  edges: Edge[]
  nodeIndex: Map<string, Node>
  selectedEdgeInfo: SelectedEdgeInfo | null
  onDelete: (edgeId: string) => void
}

export function deriveEdgesWithSelection({
  edges,
  nodeIndex,
  selectedEdgeInfo,
  onDelete,
}: DeriveEdgesWithSelectionParams): Edge[] {
  return edges.map((edge) => {
    const parentLoopId = getParentLoopIdForEdge(edge, nodeIndex)
    const edgeContextId = buildEdgeContextId(edge.id, parentLoopId)

    return {
      ...edge,
      data: {
        ...edge.data,
        isSelected: selectedEdgeInfo?.contextId === edgeContextId,
        isInsideLoop: Boolean(parentLoopId),
        parentLoopId,
        onDelete,
      },
    }
  })
}
