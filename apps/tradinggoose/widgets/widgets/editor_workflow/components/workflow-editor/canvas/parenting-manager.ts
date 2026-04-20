import type { BlockState } from '@/stores/workflows/workflow/types'
import { isBlockProtected } from '@/stores/workflows/workflow/utils'
import type { WorkflowCanvasNodeData } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/block-registry'
import {
  calculateRelativePosition,
  getNodeAbsolutePosition,
  getNodeDepth,
  getNodeHierarchy,
  resizeContainerNodes,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/node-position-utils'
import type { Edge, Node } from '@xyflow/react'

type BlocksById = Record<string, BlockState>
type WorkflowCanvasNode = Node<WorkflowCanvasNodeData>
type GetNodes = () => WorkflowCanvasNode[]

interface UpdateNodeParentParams {
  nodeId: string
  newParentId: string | null
  blocks: BlocksById
  getNodes: GetNodes
  edgesForDisplay: Edge[]
  affectedEdges?: Edge[]
  updateBlockPosition: (id: string, position: { x: number; y: number }, isFinal?: boolean) => void
  updateParentId: (id: string, parentId: string, extent: 'parent') => void
  updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void
}

interface ParentUpdateResult {
  changed: boolean
  oldParentId: string | null
  newParentId: string | null
  oldPosition: { x: number; y: number }
  newPosition: { x: number; y: number }
  affectedEdges: Edge[]
}

interface FindClosestContainerParams {
  node: WorkflowCanvasNode
  blocks: BlocksById
  getNodes: GetNodes
}

interface BuildContainerEdgesParams {
  blocks: BlocksById
  getNodes: GetNodes
  targetParentId: string
  nodeId: string
  relativePosition: { x: number; y: number }
  determineSourceHandle: (block: { id: string; type: string }) => string
}

function getNodeRect(node: WorkflowCanvasNode, absolutePosition: { x: number; y: number }) {
  const width =
    node.type === 'subflowNode'
      ? (node.data?.width ?? 500)
      : node.type === 'condition'
        ? 250
        : 350

  const height =
    node.type === 'subflowNode'
      ? (node.data?.height ?? 300)
      : node.type === 'condition'
        ? 150
        : 100

  return {
    left: absolutePosition.x,
    right: absolutePosition.x + width,
    top: absolutePosition.y,
    bottom: absolutePosition.y + height,
  }
}

export function clearContainerHighlights(): void {
  document.querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over').forEach((element) => {
    element.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
  })
  document.body.style.cursor = ''
}

export function applyContainerHighlight(containerId: string, getNodes: GetNodes): void {
  const containerElement = document.querySelector(`[data-id="${containerId}"]`)
  if (!containerElement) {
    return
  }

  const containerNode = getNodes().find((node) => node.id === containerId)

  if (containerNode?.type === 'subflowNode' && (containerNode.data as { kind?: string })?.kind === 'loop') {
    containerElement.classList.add('loop-node-drag-over')
  } else if (
    containerNode?.type === 'subflowNode' &&
    (containerNode.data as { kind?: string })?.kind === 'parallel'
  ) {
    containerElement.classList.add('parallel-node-drag-over')
  }

  document.body.style.cursor = 'copy'
}

export function updateNodeParentForCanvas({
  nodeId,
  newParentId,
  blocks,
  getNodes,
  edgesForDisplay,
  affectedEdges,
  updateBlockPosition,
  updateParentId,
  updateNodeDimensions,
}: UpdateNodeParentParams): ParentUpdateResult | null {
  const node = getNodes().find((item) => item.id === nodeId)
  if (!node) {
    return null
  }

  const currentBlock = blocks[nodeId]
  if (!currentBlock) {
    return null
  }

  const oldParentId = node.parentId || currentBlock.data?.parentId || null
  if (oldParentId === newParentId) {
    return {
      changed: false,
      oldParentId,
      newParentId,
      oldPosition: { ...node.position },
      newPosition: { ...node.position },
      affectedEdges: affectedEdges ?? [],
    }
  }

  let resolvedAffectedEdges = affectedEdges ?? []
  if (!resolvedAffectedEdges.length && !newParentId && oldParentId) {
    resolvedAffectedEdges = edgesForDisplay.filter((edge) => edge.source === nodeId || edge.target === nodeId)
  }

  const oldPosition = { ...node.position }
  let nextPosition = { ...node.position }

  if (newParentId) {
    nextPosition = calculateRelativePosition(nodeId, newParentId, getNodes, blocks)
    updateBlockPosition(nodeId, nextPosition)
    updateParentId(nodeId, newParentId, 'parent')
  } else if (oldParentId) {
    nextPosition = getNodeAbsolutePosition(nodeId, getNodes, blocks)
    updateBlockPosition(nodeId, nextPosition)
    updateParentId(nodeId, '', 'parent')
  }

  resizeContainerNodes(getNodes, updateNodeDimensions, blocks)

  return {
    changed: true,
    oldParentId,
    newParentId,
    oldPosition,
    newPosition: nextPosition,
    affectedEdges: resolvedAffectedEdges,
  }
}

export function findBestContainerForDraggedNode({
  node,
  blocks,
  getNodes,
}: FindClosestContainerParams): string | null {
  const currentParentId = blocks[node.id]?.data?.parentId || null
  const nodeAbsolutePos = getNodeAbsolutePosition(node.id, getNodes, blocks)
  const nodeRect = getNodeRect(node, nodeAbsolutePos)

  const intersections = getNodes()
    .filter((candidate) => {
      if (candidate.type !== 'subflowNode' || candidate.id === node.id) {
        return false
      }

      if (candidate.id === currentParentId) {
        return false
      }

      if (isBlockProtected(candidate.id, blocks)) {
        return false
      }

      if (node.type === 'subflowNode') {
        const hierarchy = getNodeHierarchy(candidate.id, getNodes, blocks)
        if (hierarchy.includes(node.id)) {
          return false
        }
      }

      const candidateAbsPos = getNodeAbsolutePosition(candidate.id, getNodes, blocks)
      const candidateRect = {
        left: candidateAbsPos.x,
        right: candidateAbsPos.x + (candidate.data?.width || 500),
        top: candidateAbsPos.y,
        bottom: candidateAbsPos.y + (candidate.data?.height || 300),
      }

      return (
        nodeRect.left < candidateRect.right &&
        nodeRect.right > candidateRect.left &&
        nodeRect.top < candidateRect.bottom &&
        nodeRect.bottom > candidateRect.top
      )
    })
    .map((candidate) => ({
      id: candidate.id,
      depth: getNodeDepth(candidate.id, getNodes, blocks),
      size: (candidate.data?.width || 500) * (candidate.data?.height || 300),
    }))

  if (intersections.length === 0) {
    return null
  }

  intersections.sort((a, b) => {
    if (a.depth !== b.depth) {
      return b.depth - a.depth
    }
    return a.size - b.size
  })

  const bestCandidateId = intersections[0].id
  const dragNodeHierarchy = getNodeHierarchy(node.id, getNodes, blocks)

  if (dragNodeHierarchy.includes(bestCandidateId)) {
    return null
  }

  return bestCandidateId
}

export function buildAutoConnectEdgesForContainerDrop({
  blocks,
  getNodes,
  targetParentId,
  nodeId,
  relativePosition,
  determineSourceHandle,
}: BuildContainerEdgesParams): Edge[] {
  const existingChildren = Object.values(blocks).filter(
    (block) => block.data?.parentId === targetParentId && block.id !== nodeId
  )

  if (existingChildren.length > 0) {
    const closestChild = existingChildren
      .map((block) => ({
        block,
        distance: Math.sqrt(
          (block.position.x - relativePosition.x) ** 2 +
            (block.position.y - relativePosition.y) ** 2
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0]?.block

    if (!closestChild) {
      return []
    }

    return [
      {
        id: crypto.randomUUID(),
        source: closestChild.id,
        target: nodeId,
        sourceHandle: determineSourceHandle({ id: closestChild.id, type: closestChild.type }),
        targetHandle: 'target',
        type: 'workflowEdge',
      },
    ]
  }

  const targetContainerNode = getNodes().find((node) => node.id === targetParentId)
  const containerKind = (targetContainerNode?.data as { kind?: string } | undefined)?.kind

  return [
    {
      id: crypto.randomUUID(),
      source: targetParentId,
      target: nodeId,
      sourceHandle: containerKind === 'loop' ? 'loop-start-source' : 'parallel-start-source',
      targetHandle: 'target',
      type: 'workflowEdge',
    },
  ]
}
