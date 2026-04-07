import { useMemo } from 'react'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/references'
import { normalizeBlockName } from '@/stores/workflows/utils'
import {
  useWorkflowBlocks,
  useWorkflowEdges,
  useWorkflowLoops,
  useWorkflowParallels,
} from '@/lib/yjs/use-workflow-doc'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

export function useAccessibleReferencePrefixes(blockId?: string | null): Set<string> | undefined {
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()
  const loops = useWorkflowLoops()
  const parallels = useWorkflowParallels()

  return useMemo(() => {
    if (!blockId) {
      return undefined
    }

    const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))
    const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
    const accessibleIds = new Set<string>(ancestorIds)
    accessibleIds.add(blockId)

    const loopValues = Object.values(loops as Record<string, Loop>)
    loopValues.forEach((loop) => {
      if (!loop?.nodes) return
      if (loop.nodes.includes(blockId)) {
        loop.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
      }
    })

    const parallelValues = Object.values(parallels as Record<string, Parallel>)
    parallelValues.forEach((parallel) => {
      if (!parallel?.nodes) return
      if (parallel.nodes.includes(blockId)) {
        parallel.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
      }
    })

    const prefixes = new Set<string>()
    accessibleIds.forEach((id) => {
      prefixes.add(normalizeBlockName(id))
      const block = blocks[id]
      if (block?.name) {
        prefixes.add(normalizeBlockName(block.name))
      }

      if (block?.type === 'input_trigger') {
        prefixes.add('start')
      }
    })

    SYSTEM_REFERENCE_PREFIXES.forEach((prefix) => prefixes.add(prefix))

    return prefixes
  }, [blockId, blocks, edges, loops, parallels])
}
