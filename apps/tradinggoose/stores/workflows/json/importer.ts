import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  parseImportedWorkflowFile,
  type WorkflowTransferRecord,
} from '@/lib/workflows/import-export'
import type { WorkflowState } from '../workflow/types'

const logger = createLogger('WorkflowJsonImporter')

/**
 * Generate new IDs for all blocks and edges to avoid conflicts
 */
function regenerateIds(workflowState: WorkflowState): WorkflowState {
  const blockIdMap = new Map<string, string>()
  const newBlocks: WorkflowState['blocks'] = {}

  // First pass: create new IDs for all blocks
  Object.entries(workflowState.blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)
    newBlocks[newId] = {
      ...block,
      id: newId,
    }
  })

  // Second pass: update edges with new block IDs
  const newEdges = workflowState.edges.map((edge) => ({
    ...edge,
    id: uuidv4(), // Generate new edge ID
    source: blockIdMap.get(edge.source) || edge.source,
    target: blockIdMap.get(edge.target) || edge.target,
  }))

  // Third pass: update loops with new block IDs
  // CRITICAL: Loop IDs must match their block IDs (loops are keyed by their block ID)
  const newLoops: WorkflowState['loops'] = {}
  if (workflowState.loops) {
    Object.entries(workflowState.loops).forEach(([oldLoopId, loop]) => {
      // Map the loop ID using the block ID mapping (loop ID = block ID)
      const newLoopId = blockIdMap.get(oldLoopId) || oldLoopId
      newLoops[newLoopId] = {
        ...loop,
        id: newLoopId,
        nodes: loop.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  // Fourth pass: update parallels with new block IDs
  // CRITICAL: Parallel IDs must match their block IDs (parallels are keyed by their block ID)
  const newParallels: WorkflowState['parallels'] = {}
  if (workflowState.parallels) {
    Object.entries(workflowState.parallels).forEach(([oldParallelId, parallel]) => {
      // Map the parallel ID using the block ID mapping (parallel ID = block ID)
      const newParallelId = blockIdMap.get(oldParallelId) || oldParallelId
      newParallels[newParallelId] = {
        ...parallel,
        id: newParallelId,
        nodes: parallel.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  // Fifth pass: update any block references in subblock values
  Object.entries(newBlocks).forEach(([blockId, block]) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (subBlock.value && typeof subBlock.value === 'string') {
          // Replace any block references in the value
          let updatedValue = subBlock.value
          blockIdMap.forEach((newId, oldId) => {
            // Replace references like <blockId.output> with new IDs
            const regex = new RegExp(`<${oldId}\\.`, 'g')
            updatedValue = updatedValue.replace(regex, `<${newId}.`)
          })
          block.subBlocks[subBlockId] = {
            ...subBlock,
            value: updatedValue,
          }
        }
      })
    }

    // Update parentId references in block.data
    if (block.data?.parentId) {
      const newParentId = blockIdMap.get(block.data.parentId)
      if (newParentId) {
        block.data.parentId = newParentId
      } else {
        // Parent ID not in mapping - this shouldn't happen but log it
        logger.warn(`Block ${blockId} references unmapped parent ${block.data.parentId}`)
        // Remove invalid parent reference
        block.data.parentId = undefined
        block.data.extent = undefined
      }
    }
  })

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
  }
}

export function parseWorkflowJson(
  jsonContent: string,
  regenerateIdsFlag = true,
  options: { fallbackName?: string } = {}
): {
  data: WorkflowTransferRecord | null
  errors: string[]
} {
  const errors: string[] = []

  try {
    let data: unknown
    try {
      data = JSON.parse(jsonContent)
    } catch (parseError) {
      errors.push(
        `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
      )
      return { data: null, errors }
    }

    if (!data || typeof data !== 'object') {
      errors.push('Invalid JSON: Root must be an object')
      return { data: null, errors }
    }

    logger.info('Parsing workflow JSON', {
      version: (data as Record<string, unknown>).version,
      fileType: (data as Record<string, unknown>).fileType,
      exportedFrom: (data as Record<string, unknown>).exportedFrom,
    })

    const parsed = parseImportedWorkflowFile(data, {
      fallbackName: options.fallbackName,
    })

    if (!parsed.data || parsed.errors.length > 0) {
      return parsed
    }

    let workflowData: WorkflowTransferRecord = parsed.data

    if (regenerateIdsFlag) {
      workflowData = {
        ...workflowData,
        state: regenerateIds(workflowData.state),
      }
      logger.info('Regenerated IDs for imported workflow to avoid conflicts')
    }

    logger.info('Successfully parsed workflow JSON', {
      name: workflowData.name,
      description: workflowData.description,
      color: workflowData.color,
      blocksCount: Object.keys(workflowData.state.blocks).length,
      edgesCount: workflowData.state.edges.length,
      loopsCount: Object.keys(workflowData.state.loops).length,
      parallelsCount: Object.keys(workflowData.state.parallels).length,
    })

    return { data: workflowData, errors: [] }
  } catch (error) {
    logger.error('Failed to parse workflow JSON:', error)
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
}
