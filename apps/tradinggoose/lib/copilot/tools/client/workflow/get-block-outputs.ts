import { createLogger } from '@/lib/logs/console/logger'
import { Loader2, Tag, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  computeBlockOutputReferences,
  getSubflowInsideOutputReferences,
  getSubflowOutsideOutputReferences,
  getWorkflowSubBlockValues,
  getWorkflowVariableOutputs,
} from '@/lib/copilot/tools/client/workflow/block-output-utils'
import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import {
  GetBlockOutputsResult,
  type GetBlockOutputsResultType,
} from '@/lib/copilot/tools/shared/schemas'

const logger = createLogger('GetBlockOutputsClientTool')

interface GetBlockOutputsArgs {
  blockIds?: string[]
  workflowId: string
}

export class GetBlockOutputsClientTool extends BaseClientTool {
  static readonly id = 'get_block_outputs'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlockOutputsClientTool.id, GetBlockOutputsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block outputs', icon: Tag },
      [ClientToolCallState.executing]: { text: 'Getting block outputs', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting outputs', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved block outputs', icon: Tag },
      [ClientToolCallState.error]: { text: 'Failed to get outputs', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped getting outputs', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
        const count = blockIds.length
        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved outputs for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Getting outputs for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.error:
            return `Failed to get outputs for ${count} block${count > 1 ? 's' : ''}`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlockOutputsArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()

      const { workflowId: activeWorkflowId, workflowState: snapshot, variables } =
        await getReadableWorkflowState(executionContext, args?.workflowId)
      const blocks = snapshot.blocks || {}
      const loops = snapshot.loops || {}
      const parallels = snapshot.parallels || {}
      const subBlockValues = getWorkflowSubBlockValues(activeWorkflowId, snapshot)
      const variableOutputs = getWorkflowVariableOutputs(variables)

      const ctx = { blocks, loops, parallels, subBlockValues }
      const targetBlockIds =
        args?.blockIds && args.blockIds.length > 0 ? args.blockIds : Object.keys(blocks)

      const blockOutputs: GetBlockOutputsResultType['blocks'] = []

      for (const blockId of targetBlockIds) {
        const block = blocks[blockId]
        if (!block?.type) continue

        const blockName = block.name || block.type

        const blockOutput: GetBlockOutputsResultType['blocks'][0] = {
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

      const includeVariables = !args?.blockIds || args.blockIds.length === 0
      const resultData: {
        blocks: typeof blockOutputs
        variables?: ReturnType<typeof getWorkflowVariableOutputs>
      } = {
        blocks: blockOutputs,
      }
      if (includeVariables) {
        resultData.variables = variableOutputs
      }

      const result = GetBlockOutputsResult.parse(resultData)

      logger.info('Retrieved block outputs', {
        blockCount: blockOutputs.length,
        variableCount: resultData.variables?.length ?? 0,
      })

      await this.markToolComplete(200, 'Retrieved block outputs', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', { toolCallId: this.toolCallId, error, message })
      await this.markToolComplete(500, message || 'Failed to get block outputs')
      this.setState(ClientToolCallState.error)
    }
  }
}
