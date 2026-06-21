import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveBlockRuntimeState } from '@/lib/workflows/block-outputs'
import { WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import {
  parseGraphOnlyWorkflowMermaid,
  serializeWorkflowToGraphMermaid,
} from '@/lib/workflows/studio-workflow-mermaid'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { getAbsoluteBlockPosition } from '@/lib/workflows/workflow-direction'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import type { BlockState, Position } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import {
  buildWorkflowMutationResult,
  loadBaseWorkflowState,
  resolveWorkflowMutationResultForExecution,
} from './workflow-mutation-utils'

interface EditWorkflowParams {
  entityId: string
  entityDocument: string
  removedBlockIds?: string[]
}

function buildStableEdgeId(edge: {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}): string {
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

function createInitialPositionAllocator(
  graphBlocks: Array<{ blockId: string; parentId?: string }>,
  baseBlocks: Record<string, BlockState>
): (parentId?: string) => Position {
  const siblingCounts = new Map<string | undefined, number>()
  for (const graphBlock of graphBlocks) {
    if (!baseBlocks[graphBlock.blockId]) continue
    siblingCounts.set(graphBlock.parentId, (siblingCounts.get(graphBlock.parentId) ?? 0) + 1)
  }

  return (parentId?: string) => {
    const siblingCount = siblingCounts.get(parentId) ?? 0
    siblingCounts.set(parentId, siblingCount + 1)
    return parentId ? { x: 120, y: siblingCount * 180 } : { x: 0, y: siblingCount * 180 }
  }
}

function buildDefaultBlock(
  blockId: string,
  blockType: string,
  getInitialPosition: (parentId?: string) => Position,
  parentId?: string,
  name?: string
): BlockState {
  const blockConfig = getBlock(blockType)
  const data = parentId ? { parentId, extent: 'parent' as const } : undefined

  if (!blockConfig && blockType !== 'loop' && blockType !== 'parallel') {
    throw new Error(`Unknown workflow block type "${blockType}" for new block "${blockId}".`)
  }

  if (!blockConfig) {
    return {
      id: blockId,
      type: blockType,
      name: name?.trim() || (blockType === 'loop' ? 'Loop' : 'Parallel'),
      position: getInitialPosition(parentId),
      subBlocks: {},
      outputs: {},
      enabled: true,
      ...(data ? { data } : {}),
    }
  }

  const initialSubBlocks = buildInitialSubBlockStates(
    blockConfig.subBlocks
  ) as BlockState['subBlocks']
  const runtimeState = resolveBlockRuntimeState({
    blockType,
    blockConfig,
    subBlocks: initialSubBlocks,
    triggerMode: false,
  })

  return {
    id: blockId,
    type: blockType,
    name: name?.trim() || blockConfig.name,
    position: getInitialPosition(parentId),
    subBlocks: runtimeState.subBlocks as BlockState['subBlocks'],
    outputs: runtimeState.outputs,
    enabled: true,
    ...(data ? { data } : {}),
  }
}

function setParent(
  block: BlockState,
  parentId: string | undefined,
  blocks: Record<string, BlockState>,
  baseBlocks: Record<string, BlockState>
): BlockState {
  const nextPosition =
    block.data?.parentId === parentId
      ? block.position
      : (() => {
          const absolutePosition = getAbsoluteBlockPosition(block.id, baseBlocks)
          if (!parentId) return absolutePosition
          const parentPosition = getAbsoluteBlockPosition(parentId, blocks)
          return {
            x: absolutePosition.x - parentPosition.x,
            y: absolutePosition.y - parentPosition.y,
          }
        })()

  const nextData = parentId
    ? { ...(block.data ?? {}), parentId, extent: 'parent' as const }
    : (() => {
        const { parentId: _parentId, extent: _extent, ...data } = block.data ?? {}
        return data
      })()

  if (Object.keys(nextData).length === 0) {
    const { data: _data, ...blockWithoutData } = block
    return { ...blockWithoutData, position: nextPosition }
  }
  return { ...block, position: nextPosition, data: nextData }
}

function applyGraphMermaidToWorkflow(
  baseWorkflowState: WorkflowSnapshot,
  entityDocument: string,
  removedBlockIds: string[] = []
): WorkflowSnapshot & { direction: 'TD' | 'LR' } {
  const graph = parseGraphOnlyWorkflowMermaid(entityDocument, baseWorkflowState.blocks ?? {})
  const blocks: Record<string, BlockState> = {}
  const explicitRemovedBlockIds = new Set(removedBlockIds)
  for (let expanded = true; expanded; ) {
    expanded = false
    for (const [blockId, block] of Object.entries(baseWorkflowState.blocks ?? {})) {
      const parentId = block.data?.parentId
      if (
        !explicitRemovedBlockIds.has(blockId) &&
        parentId &&
        explicitRemovedBlockIds.has(parentId)
      ) {
        explicitRemovedBlockIds.add(blockId)
        expanded = true
      }
    }
  }
  const graphBlockIds = new Set(graph.blocks.map((block) => block.blockId))
  const omittedExistingBlockIds = Object.keys(baseWorkflowState.blocks ?? {}).filter(
    (blockId) => !graphBlockIds.has(blockId)
  )
  const missingRemovalIntents = omittedExistingBlockIds.filter(
    (blockId) => !explicitRemovedBlockIds.has(blockId)
  )

  if (missingRemovalIntents.length > 0) {
    throw new Error(
      `Invalid edited workflow: Existing block ids omitted from edit_workflow entityDocument without removedBlockIds: ${missingRemovalIntents.join(', ')}.`
    )
  }

  const stillPresentRemovedBlockIds = [...explicitRemovedBlockIds].filter((blockId) =>
    graphBlockIds.has(blockId)
  )
  if (stillPresentRemovedBlockIds.length > 0) {
    throw new Error(
      `Invalid edited workflow: removedBlockIds still appear in edit_workflow entityDocument: ${stillPresentRemovedBlockIds.join(', ')}.`
    )
  }

  const getInitialPosition = createInitialPositionAllocator(
    graph.blocks,
    baseWorkflowState.blocks ?? {}
  )

  for (const graphBlock of graph.blocks) {
    const existingBlock = baseWorkflowState.blocks?.[graphBlock.blockId]
    if (existingBlock) {
      if (graphBlock.blockType && graphBlock.blockType !== existingBlock.type) {
        throw new Error(
          `Invalid edited workflow: Existing block "${graphBlock.blockId}" has type "${existingBlock.type}" but entityDocument declares type "${graphBlock.blockType}". Existing block ids are immutable identities in edit_workflow; this tool cannot replace an existing block or change its type.`
        )
      }
      if (graphBlock.name && graphBlock.name.trim() !== existingBlock.name) {
        throw new Error(
          `Invalid edited workflow: Existing block "${graphBlock.blockId}" has name "${existingBlock.name}" but entityDocument declares name "${graphBlock.name}". Use edit_workflow_block to rename existing blocks.`
        )
      }
      blocks[graphBlock.blockId] = setParent(
        existingBlock,
        graphBlock.parentId,
        blocks,
        baseWorkflowState.blocks ?? {}
      )
      continue
    }
    if (!graphBlock.blockType) {
      throw new Error(`New workflow block "${graphBlock.blockId}" is missing a type label.`)
    }
    blocks[graphBlock.blockId] = buildDefaultBlock(
      graphBlock.blockId,
      graphBlock.blockType,
      getInitialPosition,
      graphBlock.parentId,
      graphBlock.name
    )
  }

  const edges = graph.edges.map((edge) => ({
    ...edge,
    id: buildStableEdgeId(edge),
    type: 'default',
    data: {},
  }))

  return createWorkflowSnapshot({
    ...baseWorkflowState,
    direction: graph.direction,
    blocks,
    edges,
    loops: generateLoopBlocks(blocks),
    parallels: generateParallelBlocks(blocks),
  }) as WorkflowSnapshot & { direction: 'TD' | 'LR' }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, any> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { entityDocument, removedBlockIds } = params
    const workflowId = requireCopilotEntityId(params, { toolName: 'edit_workflow' })

    if (!entityDocument || entityDocument.trim().length === 0) {
      throw new Error('entityDocument is required')
    }

    logger.info('Executing edit_workflow', {
      workflowId,
      documentLength: entityDocument.length,
    })

    const baseWorkflowState = await loadBaseWorkflowState(workflowId, context)
    const nextWorkflowState = applyGraphMermaidToWorkflow(
      baseWorkflowState,
      entityDocument,
      removedBlockIds
    )
    const result = buildWorkflowMutationResult({
      workflowId,
      baseWorkflowState,
      nextWorkflowState,
      renderEntityDocument: serializeWorkflowToGraphMermaid,
      documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
    })

    logger.info('edit_workflow prepared workflow graph review', {
      workflowId,
      blocksCount: Object.keys(result.workflowState.blocks).length,
      edgesCount: result.workflowState.edges.length,
      warningCount: result.preview?.warnings.length ?? 0,
    })

    return resolveWorkflowMutationResultForExecution(result, context)
  },
}
