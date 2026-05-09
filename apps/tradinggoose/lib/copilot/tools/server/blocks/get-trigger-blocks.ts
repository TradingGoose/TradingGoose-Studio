import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { listWorkflowBlockCatalogItems } from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'
import {
  type GetTriggerBlocksInput,
  GetTriggerBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export const getTriggerBlocksServerTool: BaseServerTool<
  ReturnType<typeof GetTriggerBlocksInput.parse>,
  ReturnType<typeof GetTriggerBlocksResult.parse>
> = {
  name: 'get_trigger_blocks',
  async execute() {
    const logger = createLogger('GetTriggerBlocksServerTool')
    logger.debug('Executing get_trigger_blocks')

    const triggerBlockIds = (await listWorkflowBlockCatalogItems())
      .filter((block) => block.triggerAllowed === true)
      .map((block) => block.blockType)

    logger.debug(`Found ${triggerBlockIds.length} trigger blocks`)
    return GetTriggerBlocksResult.parse({ triggerBlockIds })
  },
}
