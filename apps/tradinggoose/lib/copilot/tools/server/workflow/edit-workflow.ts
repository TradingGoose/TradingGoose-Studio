import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveBlockRuntimeState } from '@/lib/workflows/block-outputs'
import {
  parseGraphOnlyWorkflowMermaid,
} from '@/lib/workflows/studio-workflow-mermaid'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import type { BlockState, Position } from '@/stores/workflows/workflow/types'
import { buildWorkflowMutationResult, loadBaseWorkflowState } from './workflow-mutation-utils'

interface EditWorkflowParams {
  entityId: string
  entityDocument: string
  removedBlockIds?: string[]
  currentWorkflowState: string
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

function buildDefaultPosition(blocks: Record<string, BlockState>, parentId?: string): Position {
  const siblingCount = Object.values(blocks).filter(
    (block) => block.data?.parentId === parentId
  ).length
  return parentId ? { x: 120, y: siblingCount * 180 } : { x: 0, y: siblingCount * 180 }
}

function buildDefaultBlock(
  blockId: string,
  blockType: string,
  blocks: Record<string, BlockState>,
  parentId?: string
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
      name: blockType === 'loop' ? 'Loop' : 'Parallel',
      position: buildDefaultPosition(blocks, parentId),
      subBlocks: {},
      outputs: {},
      enabled: true,
      ...(data ? { data } : {}),
    }
  }

  const initialSubBlocks = Object.fromEntries(
    blockConfig.subBlocks.map((subBlock) => [
      subBlock.id,
      { id: subBlock.id, type: subBlock.type, value: null },
    ])
  )
  const runtimeState = resolveBlockRuntimeState({
    blockType,
    blockConfig,
    subBlocks: initialSubBlocks,
    triggerMode: false,
  })

  return {
    id: blockId,
    type: blockType,
    name: blockConfig.name,
    position: buildDefaultPosition(blocks, parentId),
    subBlocks: runtimeState.subBlocks as BlockState['subBlocks'],
    outputs: runtimeState.outputs,
    enabled: true,
    ...(data ? { data } : {}),
  }
}

function setParent(block: BlockState, parentId?: string): BlockState {
  const nextData = { ...(block.data ?? {}) }
  if (parentId) {
    nextData.parentId = parentId
    nextData.extent = 'parent'
  } else {
    delete nextData.parentId
    delete nextData.extent
  }

  if (Object.keys(nextData).length === 0) {
    const { data: _data, ...blockWithoutData } = block
    return blockWithoutData
  }
  return { ...block, data: nextData }
}

function applyGraphMermaidToWorkflow(
  baseWorkflowState: WorkflowSnapshot,
  entityDocument: string,
  removedBlockIds: string[] = []
): WorkflowSnapshot & { direction: 'TD' | 'LR' } {
  const graph = parseGraphOnlyWorkflowMermaid(entityDocument, baseWorkflowState.blocks ?? {})
  const blocks: Record<string, BlockState> = {}
  const explicitRemovedBlockIds = new Set(removedBlockIds)
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

  const stillPresentRemovedBlockIds = removedBlockIds.filter((blockId) => graphBlockIds.has(blockId))
  if (stillPresentRemovedBlockIds.length > 0) {
    throw new Error(
      `Invalid edited workflow: removedBlockIds still appear in edit_workflow entityDocument: ${stillPresentRemovedBlockIds.join(', ')}.`
    )
  }

  for (const graphBlock of graph.blocks) {
    const existingBlock = baseWorkflowState.blocks?.[graphBlock.blockId]
    if (existingBlock) {
      blocks[graphBlock.blockId] = setParent(existingBlock, graphBlock.parentId)
      continue
    }
    if (!graphBlock.blockType) {
      throw new Error(`New workflow block "${graphBlock.blockId}" is missing a type label.`)
    }
    blocks[graphBlock.blockId] = buildDefaultBlock(
      graphBlock.blockId,
      graphBlock.blockType,
      blocks,
      graphBlock.parentId
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
  async execute(params: EditWorkflowParams): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { entityDocument, removedBlockIds, currentWorkflowState } = params
    const workflowId = requireCopilotEntityId(params, { toolName: 'edit_workflow' })

    if (!entityDocument || entityDocument.trim().length === 0) {
      throw new Error('entityDocument is required')
    }

    logger.info('Executing edit_workflow', {
      workflowId,
      documentLength: entityDocument.length,
    })

    const baseWorkflowState = await loadBaseWorkflowState(workflowId, currentWorkflowState)
    const nextWorkflowState = applyGraphMermaidToWorkflow(
      baseWorkflowState,
      entityDocument,
      removedBlockIds
    )
    const result = buildWorkflowMutationResult({
      workflowId,
      baseWorkflowState,
      nextWorkflowState,
      requestedDirection: nextWorkflowState.direction,
    })

    logger.info('edit_workflow successfully applied workflow graph', {
      workflowId,
      blocksCount: Object.keys(result.workflowState.blocks).length,
      edgesCount: result.workflowState.edges.length,
      warningCount: result.preview?.warnings.length ?? 0,
    })

    return result
  },
}
