import type { Node } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowCanvasNodePositionUtils')

const DEFAULT_CONTAINER_WIDTH = 500
const DEFAULT_CONTAINER_HEIGHT = 300

type BlocksById = Record<string, BlockState>
type GetNodes = () => Node[]

function isContainerType(type?: string): boolean {
  return (
    type === 'loop' ||
    type === 'parallel' ||
    type === 'loopNode' ||
    type === 'parallelNode' ||
    type === 'subflowNode'
  )
}

function getBlockDimensions(
  blocks: BlocksById,
  blockId: string
): { width: number; height: number } {
  const block = blocks[blockId]
  if (!block) {
    return { width: 350, height: 150 }
  }

  if (isContainerType(block.type)) {
    return {
      width: block.data?.width ? Math.max(block.data.width, 400) : DEFAULT_CONTAINER_WIDTH,
      height: block.data?.height ? Math.max(block.data.height, 200) : DEFAULT_CONTAINER_HEIGHT,
    }
  }

  return {
    width: block.layout?.measuredWidth || block.data?.width || 350,
    height: Math.max(
      block.layout?.measuredHeight || block.height || block.data?.height || 150,
      100
    ),
  }
}

export function getNodeDepth(
  nodeId: string,
  getNodes: GetNodes,
  blocks: BlocksById,
  maxDepth = 100
): number {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node || maxDepth <= 0) {
    return 0
  }

  const parentId = blocks[nodeId]?.data?.parentId
  if (!parentId) {
    return 0
  }

  return 1 + getNodeDepth(parentId, getNodes, blocks, maxDepth - 1)
}

export function getNodeHierarchy(nodeId: string, getNodes: GetNodes, blocks: BlocksById): string[] {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) {
    return [nodeId]
  }

  const parentId = blocks[nodeId]?.data?.parentId
  if (!parentId) {
    return [nodeId]
  }

  return [...getNodeHierarchy(parentId, getNodes, blocks), nodeId]
}

export function getNodeAbsolutePosition(
  nodeId: string,
  getNodes: GetNodes,
  blocks: BlocksById
): { x: number; y: number } {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) {
    logger.warn('Attempted to get position of non-existent node', { nodeId })
    return { x: 0, y: 0 }
  }

  const parentId = blocks[nodeId]?.data?.parentId
  if (!parentId) {
    return node.position
  }

  const parentNode = getNodes().find((n) => n.id === parentId)
  if (!parentNode) {
    logger.warn('Node references non-existent parent', {
      nodeId,
      invalidParentId: parentId,
    })
    return node.position
  }

  const visited = new Set<string>()
  let currentId: string | undefined = nodeId
  while (currentId && blocks[currentId]?.data?.parentId) {
    const currentParentId: string | undefined = blocks[currentId]?.data?.parentId
    if (!currentParentId) {
      break
    }

    if (visited.has(currentParentId)) {
      logger.error('Circular parent reference detected', {
        nodeId,
        parentChain: Array.from(visited),
      })
      return node.position
    }

    visited.add(currentId)
    currentId = currentParentId
  }

  const parentPos = getNodeAbsolutePosition(parentId, getNodes, blocks)

  return {
    x: parentPos.x + node.position.x,
    y: parentPos.y + node.position.y,
  }
}

export function calculateRelativePosition(
  nodeId: string,
  newParentId: string,
  getNodes: GetNodes,
  blocks: BlocksById
): { x: number; y: number } {
  const nodeAbsPos = getNodeAbsolutePosition(nodeId, getNodes, blocks)
  const parentAbsPos = getNodeAbsolutePosition(newParentId, getNodes, blocks)

  return {
    x: nodeAbsPos.x - parentAbsPos.x,
    y: nodeAbsPos.y - parentAbsPos.y,
  }
}

export function isPointInContainerNode(
  position: { x: number; y: number },
  getNodes: GetNodes,
  blocks: BlocksById
): {
  loopId: string
  loopPosition: { x: number; y: number }
  dimensions: { width: number; height: number }
} | null {
  const containingNodes = getNodes()
    .filter((node) => isContainerType(node.type))
    .filter((node) => {
      const absolutePos = getNodeAbsolutePosition(node.id, getNodes, blocks)
      const rect = {
        left: absolutePos.x,
        right: absolutePos.x + (node.data?.width || DEFAULT_CONTAINER_WIDTH),
        top: absolutePos.y,
        bottom: absolutePos.y + (node.data?.height || DEFAULT_CONTAINER_HEIGHT),
      }

      return (
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom
      )
    })
    .map((node) => ({
      loopId: node.id,
      loopPosition: getNodeAbsolutePosition(node.id, getNodes, blocks),
      dimensions: {
        width: node.data?.width || DEFAULT_CONTAINER_WIDTH,
        height: node.data?.height || DEFAULT_CONTAINER_HEIGHT,
      },
    }))

  if (containingNodes.length === 0) {
    return null
  }

  return containingNodes.sort((a, b) => {
    const aArea = a.dimensions.width * a.dimensions.height
    const bArea = b.dimensions.width * b.dimensions.height
    return aArea - bArea
  })[0]
}

export function getNodeSourceAnchorPosition(
  nodeId: string,
  getNodes: GetNodes,
  blocks: BlocksById
): { x: number; y: number } {
  const node = getNodes().find((n) => n.id === nodeId)
  const absPos = getNodeAbsolutePosition(nodeId, getNodes, blocks)

  if (!node) {
    return absPos
  }

  const isSubflowNode = node.type === 'subflowNode'
  const width = isSubflowNode
    ? typeof node.data?.width === 'number'
      ? node.data.width
      : DEFAULT_CONTAINER_WIDTH
    : typeof node.width === 'number'
      ? node.width
      : 350

  const height = isSubflowNode
    ? typeof node.data?.height === 'number'
      ? node.data.height
      : DEFAULT_CONTAINER_HEIGHT
    : typeof node.height === 'number'
      ? node.height
      : 100

  return {
    x: absPos.x + width,
    y: absPos.y + height / 2,
  }
}

export function calculateContainerDimensions(
  nodeId: string,
  getNodes: GetNodes,
  blocks: BlocksById
): { width: number; height: number } {
  const childNodes = getNodes().filter((node) => node.parentId === nodeId)

  if (childNodes.length === 0) {
    return { width: DEFAULT_CONTAINER_WIDTH, height: DEFAULT_CONTAINER_HEIGHT }
  }

  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const child of childNodes) {
    const { width: childWidth, height: childHeight } = getBlockDimensions(blocks, child.id)
    maxX = Math.max(maxX, child.position.x + childWidth)
    maxY = Math.max(maxY, child.position.y + childHeight + 50)
  }

  const hasNestedContainers = childNodes.some((child) => isContainerType(child.type))
  const sidePadding = hasNestedContainers ? 150 : 120
  const extraPadding = 50

  return {
    width: Math.max(DEFAULT_CONTAINER_WIDTH, maxX + sidePadding + extraPadding),
    height: Math.max(DEFAULT_CONTAINER_HEIGHT, maxY + sidePadding),
  }
}

export function resizeContainerNodes(
  getNodes: GetNodes,
  updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void,
  blocks: BlocksById
): void {
  const containers = getNodes()
    .filter((node) => isContainerType(node.type))
    .map((node) => ({
      ...node,
      depth: getNodeDepth(node.id, getNodes, blocks),
    }))
    .sort((a, b) => a.depth - b.depth)

  for (const node of containers) {
    const dimensions = calculateContainerDimensions(node.id, getNodes, blocks)
    if (dimensions.width !== node.data?.width || dimensions.height !== node.data?.height) {
      updateNodeDimensions(node.id, dimensions)
    }
  }
}
