import type { MutableRefObject } from 'react'
import type { Node } from 'reactflow'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { isBlockProtected } from '@/stores/workflows/workflow/utils'
import type {
  CanvasNodeDescriptor,
  ResolveCanvasNodeDescriptorParams,
  WorkflowCanvasNodeData,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/block-registry'

interface DeriveCanvasNodesParams {
  blocks: Record<string, BlockState>
  activeBlockIds: Set<string>
  pendingBlocks: string[]
  isDebugging: boolean
  nestedSubflowErrors: Set<string>
  resolveBlockConfig: (type: string) => BlockConfig | undefined
  resolveNodeDescriptor: (params: ResolveCanvasNodeDescriptorParams) => CanvasNodeDescriptor | null
  onMissingBlockConfig?: (block: BlockState) => void
}

export function getStableBlocksHash(
  blocks: Record<string, BlockState>,
  prevBlocksRef: MutableRefObject<Record<string, BlockState>>,
  prevBlocksHashRef: MutableRefObject<string>
): string {
  if (prevBlocksRef.current === blocks) {
    return prevBlocksHashRef.current
  }

  prevBlocksRef.current = blocks

  const hash = Object.values(blocks)
    .map(
      (block) =>
        `${block.id}:${block.type}:${block.name}:${block.position.x.toFixed(0)}:${block.position.y.toFixed(0)}:${block.height}:${block.locked ? 1 : 0}:${block.data?.parentId || ''}:${block.data?.width || ''}:${block.data?.height || ''}:${block.data?.extent || ''}`
    )
    .join('|')

  prevBlocksHashRef.current = hash
  return hash
}

export function deriveCanvasNodes({
  blocks,
  activeBlockIds,
  pendingBlocks,
  isDebugging,
  nestedSubflowErrors,
  resolveBlockConfig,
  resolveNodeDescriptor,
  onMissingBlockConfig,
}: DeriveCanvasNodesParams): Node<WorkflowCanvasNodeData>[] {
  const nodes: Node<WorkflowCanvasNodeData>[] = []

  for (const block of Object.values(blocks)) {
    if (!block || !block.type || !block.name) {
      continue
    }

    const nodeDescriptor = resolveNodeDescriptor({
      block,
      isActive: activeBlockIds.has(block.id),
      isPending: isDebugging && pendingBlocks.includes(block.id),
      hasNestedError: nestedSubflowErrors.has(block.id),
      resolveBlockConfig,
      onMissingBlockConfig,
    })
    if (!nodeDescriptor) {
      continue
    }

    nodes.push({
      id: block.id,
      type: nodeDescriptor.nodeType,
      position: block.position,
      parentId: block.data?.parentId,
      draggable: !isBlockProtected(block.id, blocks),
      dragHandle: '.workflow-drag-handle',
      extent: block.data?.extent || undefined,
      data: nodeDescriptor.data,
      width: nodeDescriptor.width,
      height: nodeDescriptor.height,
    })
  }

  return nodes
}
