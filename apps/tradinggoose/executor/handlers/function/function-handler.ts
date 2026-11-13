import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import { collectBlockData } from '@/executor/handlers/tool-execution-context'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const logger = createLogger('FunctionBlockHandler')

/**
 * Handler for Function blocks that execute custom code.
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.FUNCTION
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const codeContent = Array.isArray(inputs.code)
      ? inputs.code.map((c: { content: string }) => c.content).join('\n')
      : inputs.code

    // Extract block data for variable resolution
    const { blockData, blockNameMapping } = collectBlockData(context)

    // Directly use the function_execute tool which calls the API route
    const result = await executeTool(
      'function_execute',
      {
        code: codeContent,
        timeout: inputs.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        envVars: context.environmentVariables || {},
        workflowVariables: context.workflowVariables || {},
        blockData: blockData, // Pass block data for variable resolution
        blockNameMapping: blockNameMapping, // Pass block name to ID mapping
      },
      false, // skipPostProcess
      context // execution context for file processing
    )

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return result.output
  }
}
