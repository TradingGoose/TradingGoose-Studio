import type { Edge, Node } from '@xyflow/react'

interface ConnectionLike {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface BlockLike {
  data?: {
    parentId?: string
  }
}

interface CreateConnectionEdgeParams {
  connection: ConnectionLike
  nodes: Node[]
  blocks: Record<string, BlockLike>
  createEdgeId?: () => string
}

function isContainerStartHandle(sourceHandle?: string | null): boolean {
  return sourceHandle === 'loop-start-source' || sourceHandle === 'parallel-start-source'
}

function isContainerEndTargetHandle(targetHandle?: string | null): boolean {
  return targetHandle === 'loop-end-target' || targetHandle === 'parallel-end-target'
}

function isTriggerCategory(node: Node | undefined): boolean {
  if (!node) {
    return false
  }

  const data = node.data as { config?: { category?: string } } | undefined
  return data?.config?.category === 'triggers'
}

export function createConnectionEdge({
  connection,
  nodes,
  blocks,
  createEdgeId = () => crypto.randomUUID(),
}: CreateConnectionEdgeParams): Edge | null {
  const source = connection.source
  const target = connection.target

  if (!source || !target) {
    return null
  }

  if (source === target) {
    return null
  }

  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)

  if (!sourceNode || !targetNode) {
    return null
  }

  if (isTriggerCategory(targetNode)) {
    return null
  }

  const sourceParentId =
    blocks[source]?.data?.parentId ||
    (isContainerStartHandle(connection.sourceHandle) ? source : undefined)
  const targetParentId =
    blocks[target]?.data?.parentId ||
    (isContainerEndTargetHandle(connection.targetHandle) ? target : undefined)

  const edge: Edge = {
    id: createEdgeId(),
    source,
    target,
    sourceHandle: connection.sourceHandle || undefined,
    targetHandle: connection.targetHandle || undefined,
    type: 'workflowEdge',
  }

  if (
    isContainerStartHandle(connection.sourceHandle) &&
    blocks[target]?.data?.parentId === source
  ) {
    return {
      ...edge,
      data: {
        parentId: source,
        isInsideContainer: true,
      },
    }
  }

  if (
    (sourceParentId && !targetParentId) ||
    (!sourceParentId && targetParentId) ||
    (sourceParentId && targetParentId && sourceParentId !== targetParentId)
  ) {
    return null
  }

  if (sourceParentId || targetParentId) {
    return {
      ...edge,
      data: {
        parentId: sourceParentId || targetParentId,
        isInsideContainer: true,
      },
    }
  }

  return edge
}
