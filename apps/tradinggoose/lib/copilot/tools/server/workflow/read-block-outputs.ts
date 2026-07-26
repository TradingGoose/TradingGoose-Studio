import { CopilotTool } from '@/lib/copilot/registry'
import {
  computeBlockOutputReferences,
  extractSubBlockValuesFromBlocks,
  getSubflowInsideOutputReferences,
  getSubflowOutsideOutputReferences,
  readWorkflowVariableOutputs,
} from '@/lib/copilot/workflow/block-output-utils'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type {
  ReadBlockOutputsResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { loadWorkflowSnapshotForCopilot } from '@/lib/copilot/tools/server/entities/workflow'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ReadBlockOutputsServerTool')

type ReadBlockOutputsArgs = {
  entityId: string
  blockIds?: string[]
}

export const readBlockOutputsServerTool: BaseServerTool<
  ReadBlockOutputsArgs,
  ReadBlockOutputsResultType
> = {
  name: CopilotTool.read_block_outputs,
  async execute(args, context) {
    const {
      workflowId,
      workflowState: snapshot,
      variables,
    } = await loadWorkflowSnapshotForCopilot(args.entityId, context, 'read')
    const blocks = snapshot.blocks || {}
    const loops = snapshot.loops || {}
    const parallels = snapshot.parallels || {}
    const subBlockValues = extractSubBlockValuesFromBlocks(blocks)
    const variableOutputs = readWorkflowVariableOutputs(variables)
    const ctx = { blocks, loops, parallels, subBlockValues }
    const targetBlockIds =
      args.blockIds && args.blockIds.length > 0 ? args.blockIds : Object.keys(blocks)

    const blockOutputs: ReadBlockOutputsResultType['blocks'] = []

    for (const blockId of targetBlockIds) {
      const block = blocks[blockId]
      if (!block?.type) continue

      const blockName = block.name || block.type
      const blockOutput: ReadBlockOutputsResultType['blocks'][0] = {
        blockId,
        blockName,
        blockType: block.type,
        outputs: [],
      }

      if (block.type === 'loop' || block.type === 'parallel') {
        blockOutput.insideSubflowOutputs = getSubflowInsideOutputReferences(
          block.type,
          blockId,
          blockName,
          loops,
          parallels
        )
        blockOutput.outsideSubflowOutputs = getSubflowOutsideOutputReferences(blockName)
      } else {
        blockOutput.outputs = computeBlockOutputReferences(block, ctx, variableOutputs)
      }

      blockOutputs.push(blockOutput)
    }

    const includeVariables = !args.blockIds || args.blockIds.length === 0
    logger.info('Retrieved workflow block outputs', {
      workflowId,
      blockCount: blockOutputs.length,
      variableCount: includeVariables ? variableOutputs.length : 0,
    })

    return {
      blocks: blockOutputs,
      ...(includeVariables ? { variables: variableOutputs } : {}),
    }
  },
}
