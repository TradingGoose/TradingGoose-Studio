import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { layoutContainers } from './containers'
import { assignLayers, groupByLayer } from './layering'
import { calculatePositions } from './positioning'
import type { Edge, LayoutOptions, LayoutResult } from './types'
import { getBlocksByParent, prepareBlockMetrics } from './utils'

const logger = createLogger('AutoLayout')

export function applyAutoLayout(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: LayoutOptions = {}
): LayoutResult {
  try {
    logger.info('Starting auto layout', {
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    const blocksCopy: Record<string, BlockState> = JSON.parse(JSON.stringify(blocks))

    layoutContainers(blocksCopy, edges, options)

    const { root: rootBlockIds } = getBlocksByParent(blocksCopy)

    const rootBlocks: Record<string, BlockState> = {}
    for (const id of rootBlockIds) {
      rootBlocks[id] = blocksCopy[id]
    }

    const rootEdges = edges.filter(
      (edge) => rootBlockIds.includes(edge.source) && rootBlockIds.includes(edge.target)
    )

    if (Object.keys(rootBlocks).length > 0) {
      const nodes = assignLayers(rootBlocks, rootEdges)
      prepareBlockMetrics(nodes)
      const layers = groupByLayer(nodes)
      calculatePositions(layers, rootEdges, options)

      for (const node of nodes.values()) {
        blocksCopy[node.id].position = node.position
      }
    }

    layoutContainers(blocksCopy, edges, options)

    logger.info('Auto layout completed successfully', {
      blockCount: Object.keys(blocksCopy).length,
    })

    return {
      blocks: blocksCopy,
      success: true,
    }
  } catch (error) {
    logger.error('Auto layout failed', { error })
    return {
      blocks,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export type { LayoutOptions, LayoutResult, Edge }
export { getBlockMetrics, isContainerType } from './utils'
