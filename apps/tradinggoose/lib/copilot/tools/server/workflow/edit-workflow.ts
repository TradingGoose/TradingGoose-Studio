import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveBlockRuntimeState } from '@/lib/workflows/block-outputs'
import { WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import { parseGraphOnlyWorkflowMermaid } from '@/lib/workflows/studio-workflow-mermaid'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { getAbsoluteBlockPosition } from '@/lib/workflows/workflow-direction'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import type { BlockState, Position } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
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
      position: buildDefaultPosition(blocks, parentId),
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
    position: buildDefaultPosition(blocks, parentId),
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

  const stillPresentRemovedBlockIds = removedBlockIds.filter((blockId) =>
    graphBlockIds.has(blockId)
  )
  if (stillPresentRemovedBlockIds.length > 0) {
    throw new Error(
      `Invalid edited workflow: removedBlockIds still appear in edit_workflow entityDocument: ${stillPresentRemovedBlockIds.join(', ')}.`
    )
  }

  for (const graphBlock of graph.blocks) {
    const existingBlock = baseWorkflowState.blocks?.[graphBlock.blockId]
    if (existingBlock) {
      if (graphBlock.blockType && graphBlock.blockType !== existingBlock.type) {
        throw new Error(
          `Invalid edited workflow: Existing block "${graphBlock.blockId}" has type "${existingBlock.type}" but entityDocument declares type "${graphBlock.blockType}". Existing block types are immutable in edit_workflow.`
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
      blocks,
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
      entityDocument: entityDocument.trim(),
      documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
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
