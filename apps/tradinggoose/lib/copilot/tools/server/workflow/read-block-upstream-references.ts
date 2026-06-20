import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  computeBlockOutputReferences,
  extractSubBlockValuesFromBlocks,
  getSubflowInsideOutputReferences,
  getSubflowOutsideOutputReferences,
  readWorkflowVariableOutputs,
} from '@/lib/copilot/workflow/block-output-utils'
import { loadWorkflowSnapshotForCopilot } from '@/lib/copilot/tools/server/entities/workflow'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { ReadBlockUpstreamReferencesResultType } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

const logger = createLogger('ReadBlockUpstreamReferencesServerTool')

type ReadBlockUpstreamReferencesArgs = {
  entityId: string
  blockIds: string[]
}

export const readBlockUpstreamReferencesServerTool: BaseServerTool<
  ReadBlockUpstreamReferencesArgs,
  ReadBlockUpstreamReferencesResultType
> = {
  name: CopilotTool.read_block_upstream_references,
  async execute(args, context) {
    const { workflowState: snapshot, variables } = await loadWorkflowSnapshotForCopilot(
      args.entityId,
      context,
      'read'
    )
    const blocks = snapshot.blocks || {}
    const edges = snapshot.edges || []
    const loops = snapshot.loops || {}
    const parallels = snapshot.parallels || {}
    const subBlockValues = extractSubBlockValuesFromBlocks(blocks)
    const ctx = { blocks, loops, parallels, subBlockValues }
    const variableOutputs = readWorkflowVariableOutputs(variables)
    const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))
    const results: ReadBlockUpstreamReferencesResultType['results'] = []

    for (const blockId of args.blockIds) {
      const targetBlock = blocks[blockId]
      if (!targetBlock) {
        logger.warn('Workflow block not found while reading upstream references', { blockId })
        continue
      }

      const insideSubflows: { blockId: string; blockName: string; blockType: string }[] = []
      const containingLoopIds = new Set<string>()
      const containingParallelIds = new Set<string>()

      Object.values(loops as Record<string, Loop>).forEach((loop) => {
        if (!loop?.nodes?.includes(blockId)) return
        containingLoopIds.add(loop.id)
        const loopBlock = blocks[loop.id]
        if (loopBlock) {
          insideSubflows.push({
            blockId: loop.id,
            blockName: loopBlock.name || loopBlock.type,
            blockType: 'loop',
          })
        }
      })

      Object.values(parallels as Record<string, Parallel>).forEach((parallel) => {
        if (!parallel?.nodes?.includes(blockId)) return
        containingParallelIds.add(parallel.id)
        const parallelBlock = blocks[parallel.id]
        if (parallelBlock) {
          insideSubflows.push({
            blockId: parallel.id,
            blockName: parallelBlock.name || parallelBlock.type,
            blockType: 'parallel',
          })
        }
      })

      const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
      const accessibleIds = new Set<string>(ancestorIds)
      accessibleIds.add(blockId)

      containingLoopIds.forEach((loopId) => {
        accessibleIds.add(loopId)
        loops[loopId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
      })

      containingParallelIds.forEach((parallelId) => {
        accessibleIds.add(parallelId)
        parallels[parallelId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
      })

      const accessibleBlocks: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'] =
        []

      for (const accessibleBlockId of accessibleIds) {
        const block = blocks[accessibleBlockId]
        if (!block?.type) continue

        const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
        if (accessibleBlockId === blockId && !canSelfReference) continue

        const blockName = block.name || block.type
        let accessContext: 'inside' | 'outside' | undefined
        let outputs: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'][0]['outputs']

        if (block.type === 'loop' || block.type === 'parallel') {
          const isInside =
            (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
            (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))

          accessContext = isInside ? 'inside' : 'outside'
          outputs = isInside
            ? getSubflowInsideOutputReferences(
                block.type,
                accessibleBlockId,
                blockName,
                loops,
                parallels
              )
            : getSubflowOutsideOutputReferences(blockName)
        } else {
          outputs = computeBlockOutputReferences(block, ctx, variableOutputs)
        }

        const entry: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'][0] = {
          blockId: accessibleBlockId,
          blockName,
          blockType: block.type,
          outputs,
        }

        if (accessContext) entry.accessContext = accessContext
        accessibleBlocks.push(entry)
      }

      const resultEntry: ReadBlockUpstreamReferencesResultType['results'][0] = {
        blockId,
        blockName: targetBlock.name || targetBlock.type,
        accessibleBlocks,
        variables: variableOutputs,
      }

      if (insideSubflows.length > 0) resultEntry.insideSubflows = insideSubflows
      results.push(resultEntry)
    }

    return { results }
  },
}
