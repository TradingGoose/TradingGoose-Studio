import type { Edge } from '@xyflow/react'
import type { BlockOutput, SubBlockType } from '@/blocks/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'

export const DEFAULT_WORKFLOW_CHANNEL_ID = 'default'

export const SUBFLOW_TYPES = {
  LOOP: 'loop',
  PARALLEL: 'parallel',
} as const

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  // Parent-child relationships for container nodes
  parentId?: string
  extent?: 'parent'

  // Container dimensions
  width?: number
  height?: number

  // Container node type (for ReactFlow node type determination)
  type?: string
}

export interface BlockLayoutState {
  measuredWidth?: number
  measuredHeight?: number
}

export interface BlockState {
  id: string
  type: string
  name: string
  position: Position
  subBlocks: Record<string, SubBlockState>
  outputs: Record<string, BlockOutput>
  enabled: boolean
  locked?: boolean
  horizontalHandles?: boolean
  isWide?: boolean
  height?: number
  advancedMode?: boolean
  triggerMode?: boolean
  data?: BlockData
  layout?: BlockLayoutState
}

export interface SubBlockState {
  id: string
  type: SubBlockType
  value: string | number | string[][] | null
}

export interface Loop {
  id: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach' | 'while' | 'doWhile'
  forEachItems?: any[] | Record<string, any> | string // Items or expression
  whileCondition?: string // JS expression that evaluates to boolean
}

export interface Parallel {
  id: string
  nodes: string[]
  distribution?: any[] | Record<string, any> | string // Items or expression
  count?: number // Number of parallel executions for count-based parallel
  parallelType?: 'count' | 'collection' // Explicit parallel type to avoid inference bugs
}

export interface DragStartPosition {
  id: string
  x: number
  y: number
  parentId?: string | null
}

export type WorkflowDirection = 'TD' | 'LR'

export interface WorkflowState {
  direction?: WorkflowDirection
  blocks: Record<string, BlockState>
  edges: Edge[]
  lastSaved?: number | string
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  isDeployed?: boolean
  deployedAt?: Date | string
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  lastUpdate?: number
  dragStartPosition?: DragStartPosition | null
}
