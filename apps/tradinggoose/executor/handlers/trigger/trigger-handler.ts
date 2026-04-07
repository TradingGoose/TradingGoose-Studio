import { getBlock } from '@/blocks'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('TriggerBlockHandler')

/**
 * Handler for trigger blocks (Gmail, Webhook, Schedule, etc.)
 * These blocks don't execute tools - they provide input data to workflows
 */
export class TriggerBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    // Handle blocks that are triggers - either by category or by having triggerMode enabled
    const isTriggerCategory = block.metadata?.category === 'triggers'
    const blockType = block.metadata?.id ?? block.config?.tool
    const isRegisteredTrigger = blockType ? getBlock(blockType)?.category === 'triggers' : false

    // For blocks that can be both tools and triggers (like Gmail/Outlook), check if triggerMode is enabled
    // This would come from the serialized block config/params
    const hasTriggerMode = block.config?.params?.triggerMode === true

    return isTriggerCategory || isRegisteredTrigger || hasTriggerMode
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing trigger block: ${block.id} (Type: ${block.metadata?.id})`)

    // If this trigger block was initialized with a precomputed output in the execution context
    // (e.g., webhook payload injected at init), return it as-is to preserve the raw shape.
    const existingState = context.blockStates.get(block.id)
    if (existingState?.output && Object.keys(existingState.output).length > 0) {
      const existingOutput = existingState.output as any
      return existingOutput
    }

    // Fallback to resolved inputs if no initial trigger output
    if (inputs && Object.keys(inputs).length > 0) {
      logger.debug(`Returning trigger inputs for block ${block.id}`, {
        inputKeys: Object.keys(inputs),
      })
      return inputs
    }

    // Fallback - return empty object for trigger blocks with no inputs
    logger.debug(`No inputs provided for trigger block ${block.id}, returning empty object`)
    return {}
  }
}
