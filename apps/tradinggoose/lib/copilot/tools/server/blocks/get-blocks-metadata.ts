import { CopilotTool } from '@/lib/copilot/registry'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  readWorkflowBlockCatalogAvailability,
  readWorkflowBlockProfile,
} from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'
import {
  type GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: CopilotTool.get_blocks_metadata,
  async execute({
    blockTypes,
  }: ReturnType<typeof GetBlocksMetadataInput.parse>): Promise<
    ReturnType<typeof GetBlocksMetadataResult.parse>
  > {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockTypes?.length })

    const availability = await readWorkflowBlockCatalogAvailability()
    const entries = await Promise.all(
      Array.from(new Set(blockTypes || []))
        .filter(Boolean)
        .map(async (blockType) => {
          try {
            return [blockType, await readWorkflowBlockProfile(blockType, availability)] as const
          } catch (error) {
            logger.debug('Skipping unknown block in get_blocks_metadata', { blockType, error })
            return null
          }
        })
    )

    const metadata = Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, Awaited<ReturnType<typeof readWorkflowBlockProfile>>] =>
          entry !== null
      )
    )

    return GetBlocksMetadataResult.parse({ metadata })
  },
}
