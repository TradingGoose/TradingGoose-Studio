import type { EdgeTypes, NodeTypes } from 'reactflow'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { SubflowNodeComponent } from '@/widgets/widgets/editor_workflow/components/subflows/subflow-node'
import { WorkflowBlock } from '@/widgets/widgets/editor_workflow/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge'

export const workflowNodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  subflowNode: SubflowNodeComponent,
}

export const workflowEdgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

export type CanvasNodeKind = 'workflowBlock' | 'subflowNode'

export interface WorkflowCanvasNodeData {
  type?: string
  config?: BlockConfig
  name?: string
  isActive?: boolean
  isPending?: boolean
  width?: number
  height?: number
  hasNestedError?: boolean
  kind?: 'loop' | 'parallel'
  parentId?: string
  extent?: 'parent'
}

export type CanvasNodeDescriptor = {
  nodeType: CanvasNodeKind
  data: WorkflowCanvasNodeData
  width?: number
  height?: number
}

export type ResolveCanvasNodeDescriptorParams = {
  block: BlockState
  isActive: boolean
  isPending: boolean
  hasNestedError: boolean
  resolveBlockConfig: (type: string) => BlockConfig | undefined
  onMissingBlockConfig?: (block: BlockState) => void
}

type SubflowKind = 'loop' | 'parallel'

const resolveSubflowNodeDescriptor = (
  block: BlockState,
  hasNestedError: boolean,
  kind: SubflowKind
): CanvasNodeDescriptor => {
  const width = block.data?.width || 500
  const height = block.data?.height || 300

  return {
    nodeType: 'subflowNode',
    width,
    height,
    data: {
      ...block.data,
      name: block.name,
      width,
      height,
      hasNestedError,
      kind,
    },
  }
}

const resolveWorkflowNodeDescriptor = ({
  block,
  isActive,
  isPending,
  resolveBlockConfig,
  onMissingBlockConfig,
}: ResolveCanvasNodeDescriptorParams): CanvasNodeDescriptor | null => {
  const blockConfig = resolveBlockConfig(block.type)

  if (!blockConfig) {
    onMissingBlockConfig?.(block)
    return null
  }

  return {
    nodeType: 'workflowBlock',
    data: {
      type: block.type,
      config: blockConfig,
      name: block.name,
      isActive,
      isPending,
    },
    width: 350,
    height: Math.max(block.height || 100, 100),
  }
}

const SUBFLOW_NODE_RESOLVERS: Record<
  SubflowKind,
  (block: BlockState, hasNestedError: boolean) => CanvasNodeDescriptor
> = {
  loop: (block, hasNestedError) => resolveSubflowNodeDescriptor(block, hasNestedError, 'loop'),
  parallel: (block, hasNestedError) =>
    resolveSubflowNodeDescriptor(block, hasNestedError, 'parallel'),
}

export const resolveCanvasNodeDescriptor = (
  params: ResolveCanvasNodeDescriptorParams
): CanvasNodeDescriptor | null => {
  const subflowResolver = SUBFLOW_NODE_RESOLVERS[params.block.type as SubflowKind]
  if (subflowResolver) {
    return subflowResolver(params.block, params.hasNestedError)
  }

  return resolveWorkflowNodeDescriptor(params)
}

export function getBlockConfigFromCache(
  cache: Map<string, BlockConfig | undefined>,
  type: string
): BlockConfig | undefined {
  if (!cache.has(type)) {
    cache.set(type, getBlock(type))
  }

  return cache.get(type)
}
