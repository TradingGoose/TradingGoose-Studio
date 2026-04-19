import type { Edge, Node } from 'reactflow'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import {
  buildPreviewDiffStatusMap,
  type PreviewDiffOperation,
  type PreviewDiffStatus,
} from './preview-diff'

export type PreviewNodeData = {
  type: string
  name: string
  config: BlockConfig
  readOnly: true
  blockState?: BlockState
  subBlockValues?: Record<string, any>
  isPreview: boolean
  width?: number
  height?: number
  hasNestedError?: boolean
  kind?: 'loop' | 'parallel'
  diffStatus?: PreviewDiffStatus
}

export type PreviewSubflowData = {
  name: string
  width: number
  height: number
  enabled: boolean
  isPreview: true
  kind: 'loop' | 'parallel'
  diffStatus?: PreviewDiffStatus
}

export type PreviewPayloadAdapterResult = {
  nodes: Node[]
  edges: Edge[]
}

function buildPreviewEdgeId(edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): string {
  const sourceHandle =
    !edge.sourceHandle || edge.sourceHandle === 'source' || edge.sourceHandle === 'output'
      ? 'source'
      : edge.sourceHandle
  const targetHandle =
    !edge.targetHandle || edge.targetHandle === 'target' || edge.targetHandle === 'input'
      ? 'target'
      : edge.targetHandle

  return `${edge.source}-${sourceHandle}-${edge.target}-${targetHandle}`
}

function calculateAbsolutePosition(
  block: BlockState,
  blocks: Record<string, BlockState>
): { x: number; y: number } {
  if (!block.data?.parentId) {
    return block.position
  }

  const parentBlock = blocks[block.data.parentId]
  if (!parentBlock) {
    return block.position
  }

  const parentPosition = calculateAbsolutePosition(parentBlock, blocks)

  return {
    x: parentPosition.x + block.position.x,
    y: parentPosition.y + block.position.y,
  }
}

interface PreviewPayloadAdapterOptions {
  operations?: PreviewDiffOperation[]
}

export function adaptPreviewPayloadToCanvas(
  workflowState: WorkflowState,
  options?: PreviewPayloadAdapterOptions
): PreviewPayloadAdapterResult {
  const nodes: Node[] = []
  const diffStatuses = buildPreviewDiffStatusMap(options?.operations)

  Object.values(workflowState.blocks).forEach((block) => {
    const absolutePosition = calculateAbsolutePosition(block, workflowState.blocks)
    const diffStatus = diffStatuses.get(block.id)

    if (block.type === 'loop' || block.type === 'parallel') {
      nodes.push({
        id: block.id,
        type: 'subflowNode',
        position: absolutePosition,
        data: {
          name: block.name,
          width: block.data?.width || 500,
          height: block.data?.height || 300,
          enabled: block.enabled ?? true,
          isPreview: true,
          kind: block.type,
          diffStatus,
        },
      })
      return
    }

    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      return
    }

    nodes.push({
      id: block.id,
      type: 'previewNode',
      position: absolutePosition,
      data: {
        type: block.type,
        name: block.name,
        config: blockConfig,
        readOnly: true,
        blockState: block,
        subBlockValues: block.subBlocks,
        isPreview: true,
        diffStatus,
      },
    })
  })

  const edges = (workflowState.edges || []).map((edge) => ({
    ...edge,
    id: edge.id || buildPreviewEdgeId(edge),
    type: edge.type || 'workflowEdge',
  }))

  return { nodes, edges }
}
