import type { Edge, Node } from 'reactflow'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

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
}

export type PreviewSubflowData = {
  name: string
  width: number
  height: number
  enabled: boolean
  isPreview: true
  kind: 'loop' | 'parallel'
}

export type PreviewPayloadAdapterResult = {
  nodes: Node[]
  edges: Edge[]
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

export function adaptPreviewPayloadToCanvas(workflowState: WorkflowState): PreviewPayloadAdapterResult {
  const nodes: Node[] = []

  Object.values(workflowState.blocks).forEach((block) => {
    const absolutePosition = calculateAbsolutePosition(block, workflowState.blocks)

    if (block.type === 'loop' || block.type === 'parallel') {
      nodes.push({
        id: block.id,
        type: 'subflowNode',
        position: absolutePosition,
        draggable: false,
        data: {
          name: block.name,
          width: block.data?.width || 500,
          height: block.data?.height || 300,
          enabled: block.enabled ?? true,
          isPreview: true,
          kind: block.type,
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
      draggable: false,
      data: {
        type: block.type,
        name: block.name,
        config: blockConfig,
        readOnly: true,
        blockState: block,
        subBlockValues: block.subBlocks,
        isPreview: true,
      },
    })
  })

  const edges = (workflowState.edges || []).map((edge) => ({
    ...edge,
    type: edge.type || 'workflowEdge',
  }))

  return { nodes, edges }
}
