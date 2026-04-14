import { applyAutoLayout } from '@/lib/workflows/autolayout'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { BlockState, WorkflowDirection } from '@/stores/workflows/workflow/types'

export type AutoLayoutDirection = 'horizontal' | 'vertical'

type WorkflowGraphState = Pick<WorkflowSnapshot, 'blocks' | 'edges'>

function getAbsoluteBlockPosition(
  blockId: string,
  blocks: Record<string, BlockState>,
  visiting = new Set<string>()
): { x: number; y: number } {
  const block = blocks[blockId]
  if (!block) {
    return { x: 0, y: 0 }
  }

  const parentId = block.data?.parentId
  if (!parentId || !blocks[parentId] || visiting.has(blockId)) {
    return block.position
  }

  visiting.add(blockId)
  const parentPosition = getAbsoluteBlockPosition(parentId, blocks, visiting)
  visiting.delete(blockId)

  return {
    x: parentPosition.x + block.position.x,
    y: parentPosition.y + block.position.y,
  }
}

export function inferMermaidDirectionFromWorkflowState(
  workflowState: WorkflowGraphState
): WorkflowDirection {
  const blocks = workflowState.blocks ?? {}
  const edges = workflowState.edges ?? []
  const absolutePositions = new Map<string, { x: number; y: number }>()

  const getPosition = (blockId: string): { x: number; y: number } | null => {
    if (!blocks[blockId]) {
      return null
    }

    const cached = absolutePositions.get(blockId)
    if (cached) {
      return cached
    }

    const nextPosition = getAbsoluteBlockPosition(blockId, blocks)
    absolutePositions.set(blockId, nextPosition)
    return nextPosition
  }

  let horizontalDistance = 0
  let verticalDistance = 0

  for (const edge of edges) {
    const sourcePosition = getPosition(edge.source)
    const targetPosition = getPosition(edge.target)

    if (!sourcePosition || !targetPosition) {
      continue
    }

    horizontalDistance += Math.abs(targetPosition.x - sourcePosition.x)
    verticalDistance += Math.abs(targetPosition.y - sourcePosition.y)
  }

  if (horizontalDistance !== verticalDistance) {
    return horizontalDistance > verticalDistance ? 'LR' : 'TD'
  }

  const positions = Object.keys(blocks).map((blockId) => getPosition(blockId)).filter(Boolean) as Array<{
    x: number
    y: number
  }>

  if (positions.length < 2) {
    return 'TD'
  }

  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  const horizontalSpread = Math.max(...xs) - Math.min(...xs)
  const verticalSpread = Math.max(...ys) - Math.min(...ys)

  return horizontalSpread > verticalSpread ? 'LR' : 'TD'
}

function toAutoLayoutDirection(direction: WorkflowDirection): AutoLayoutDirection {
  return direction === 'LR' ? 'horizontal' : 'vertical'
}

export function resolveAutoLayoutDirection(
  workflowState: WorkflowGraphState,
  requestedDirection?: AutoLayoutDirection | 'auto'
): AutoLayoutDirection {
  if (requestedDirection && requestedDirection !== 'auto') {
    return requestedDirection
  }

  return toAutoLayoutDirection(inferMermaidDirectionFromWorkflowState(workflowState))
}

export function normalizeWorkflowStateToMermaidDirection(
  workflowState: WorkflowSnapshot,
  direction: WorkflowDirection
): {
  workflowState: WorkflowSnapshot
  didRelayout: boolean
} {
  const inferredDirection = inferMermaidDirectionFromWorkflowState(workflowState)

  if (direction === inferredDirection) {
    return {
      workflowState: {
        ...workflowState,
        direction,
      },
      didRelayout: false,
    }
  }

  const relayoutResult = applyAutoLayout(
    workflowState.blocks,
    workflowState.edges,
    workflowState.loops,
    workflowState.parallels,
    {
      direction: toAutoLayoutDirection(direction),
    }
  )

  if (!relayoutResult.success || !relayoutResult.blocks) {
    throw new Error(relayoutResult.error || 'Failed to re-layout workflow for Mermaid direction')
  }

  return {
    workflowState: {
      ...workflowState,
      direction,
      blocks: relayoutResult.blocks,
    },
    didRelayout: true,
  }
}
