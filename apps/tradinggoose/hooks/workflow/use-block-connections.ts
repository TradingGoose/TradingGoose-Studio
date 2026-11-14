import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { useWorkflowBlocks, useWorkflowEdges } from '@/lib/yjs/use-workflow-doc'

export interface ConnectedBlock {
  id: string
  type: string
  name: string
}

export function useBlockConnections(blockId: string) {
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()

  const allPathNodeIds = BlockPathCalculator.findAllPathNodes(edges, blockId)

  const toConnectedBlock = (sourceId: string): ConnectedBlock | null => {
    const sourceBlock = blocks[sourceId]
    if (!sourceBlock) return null

    return {
      id: sourceBlock.id,
      type: sourceBlock.type,
      name: sourceBlock.name,
    }
  }

  const allPathConnections = allPathNodeIds
    .map(toConnectedBlock)
    .filter(Boolean) as ConnectedBlock[]
  return {
    incomingConnections: allPathConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
